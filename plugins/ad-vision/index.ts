import type { Plugin } from "@opencode-ai/plugin"
import type { FilePart } from "@opencode-ai/sdk"
import { tool } from "@opencode-ai/plugin"
import { appendFile } from "node:fs/promises"

const VERSION = "0.4.1"

// Shared token-usage ledger. The vision model is called over raw HTTP, so its
// usage never reaches opencode's message events — the ad-stats plugin reads this
// file to fold those tokens into the per-model breakdown. Keep the path in sync
// with ad-stats/index.ts.
const USAGE_LEDGER = `${process.env.HOME}/.local/share/opencode/ad-vision-usage.jsonl`

interface Usage { input: number; output: number }
interface DescribeResult { text: string; usage: Usage }

async function recordUsage(sessionID: string, config: ResolvedConfig, usage: Usage): Promise<void> {
  if (!sessionID || (!usage.input && !usage.output)) return
  try {
    const line = JSON.stringify({
      sessionID,
      providerID: config.providerId,
      model: config.model,
      input: usage.input,
      output: usage.output,
    }) + "\n"
    await appendFile(USAGE_LEDGER, line)
  } catch (err) {
    console.error("[ad-vision] failed to record usage:", err)
  }
}

interface PluginOptions {
  provider?: string
  model?: string
}

interface ResolvedConfig {
  providerId: string
  model: string
  apiKey: string
  baseUrl: string
  isAnthropic: boolean
}

const VISION_PRIME =
  "[System: You have vision capabilities via a multimodal bridge. " +
  "Any images shared in this conversation are automatically converted to detailed text descriptions. " +
  "When you see an image, a text description follows immediately. " +
  "Trust these descriptions — they contain accurate visual information from the image. " +
  "Never say you cannot see or process images. Just read the description and work with it.]"

const DEFAULT_DESCRIBE_PROMPT =
  "Describe this image in detail. Focus on UI elements, error messages, code snippets, diagrams, or any text visible in the image. Be precise and thorough."

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".tiff", ".tif", ".avif",
])

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".tiff": "image/tiff", ".tif": "image/tiff",
  ".avif": "image/avif",
}

function isImagePath(filePath: string): boolean {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."))
  return IMAGE_EXTENSIONS.has(ext)
}

function getMediaType(filePath: string): string {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."))
  return MEDIA_TYPES[ext] || "image/png"
}

function extractBase64FromDataUrl(url: string): { base64: string; mime: string } | null {
  const match = url.match(/^data:(image\/[^;]+);.*?base64,(.+)$/s)
  if (!match) return null
  return { mime: match[1], base64: match[2] }
}

const IMAGE_MIME_PREFIXES = ["image/"]

// Known multimodal models — plugin skips if session model already supports images natively
const MULTIMODAL_PATTERNS = [
  "gpt-4o", "gpt-4-turbo", "gpt-4-vision", "gpt-5",
  "claude-3", "claude-4",
  "gemini", "gemma",
  "qwen-vl", "qwen2-vl", "qwen2.5-vl", "qwen3-vl",
  "llava", "cogvlm", "fuyu", "pixtral",
  "vision", "vl-", "-vl",
]

function isSessionModelMultimodal(modelID) {
  if (!modelID) return false
  const lower = modelID.toLowerCase()
  return MULTIMODAL_PATTERNS.some((p) => lower.includes(p))
}

function isImageMime(mime: string): boolean {
  return IMAGE_MIME_PREFIXES.some((p) => mime.startsWith(p))
}

const BUILTIN_PROVIDERS: Record<string, { api: string; isAnthropic: boolean }> = {
  openai:       { api: "https://api.openai.com/v1",             isAnthropic: false },
  anthropic:    { api: "https://api.anthropic.com/v1",          isAnthropic: true },
  openrouter:   { api: "https://openrouter.ai/api/v1",         isAnthropic: false },
  groq:         { api: "https://api.groq.com/openai/v1",       isAnthropic: false },
  deepseek:     { api: "https://api.deepseek.com/v1",          isAnthropic: false },
  together:     { api: "https://api.together.xyz/v1",          isAnthropic: false },
  fireworks:    { api: "https://api.fireworks.ai/inference/v1", isAnthropic: false },
  xai:          { api: "https://api.x.ai/v1",                  isAnthropic: false },
}

// opencode stores provider keys in auth.json, not in the provider objects
// returned by config.providers(). Read it once so auto-discovery can find keys.
async function loadAuth(): Promise<Record<string, any>> {
  try {
    const f = Bun.file(`${process.env.HOME}/.local/share/opencode/auth.json`)
    if (await f.exists()) return await f.json()
  } catch { /* no auth.json — fall back to env vars */ }
  return {}
}

function extractProviderApiKey(provider: any, auth: Record<string, any> = {}): string {
  if (provider.options?.apiKey) return provider.options.apiKey
  if (provider.request?.body?.apiKey) return provider.request.body.apiKey
  const fromAuth = auth[provider.id]?.key
  if (fromAuth) return fromAuth
  if (Array.isArray(provider.env)) {
    for (const envVar of provider.env) {
      const val = process.env[envVar]
      if (val) return val
    }
  }
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY"]) {
    const val = process.env[key]
    if (val) return val
  }
  return ""
}

function extractProviderBaseUrl(provider: any): string {
  if (provider.options?.baseURL) return provider.options.baseURL
  if (typeof provider.api === "string") return provider.api
  if (provider.api?.url) return provider.api.url
  const builtin = BUILTIN_PROVIDERS[provider.id]
  if (builtin) return builtin.api
  return ""
}

function detectIsAnthropic(provider: any): boolean {
  const builtin = BUILTIN_PROVIDERS[provider.id]
  if (builtin) return builtin.isAnthropic
  const apiField = typeof provider.api === "string" ? provider.api : provider.api?.url || ""
  if (apiField.includes("anthropic")) return true
  return false
}

// Known vision models to try when auto-discovery can't find one on a provider with a key
const DEFAULT_VISION_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229"],
  openrouter: ["google/gemini-2.5-flash-lite", "openai/gpt-4o-mini", "qwen/qwen2.5-vl-72b-instruct"],
  groq: ["llama-3.2-11b-vision-preview", "llama-3.2-90b-vision-preview"],
  deepseek: [], // no vision models
  together: ["meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo"],
  fireworks: [],
  xai: [],
}

function pickVisionModel(provider: any): string | null {
  if (!provider.models) return null
  for (const [id, m] of Object.entries(provider.models) as [string, any][]) {
    if (m?.capabilities?.input?.image || m?.modalities?.input?.includes?.("image")) {
      return id
    }
  }
  return null
}

async function resolveConfig(options: PluginOptions, client: any, envFile: Record<string, string> = {}): Promise<ResolvedConfig> {
  const env = (key: string, def: string) => envFile[key] || process.env[key] || def
  let allProviders: any[] = []
  try {
    const result = await client.config.providers()
    allProviders = result?.data?.providers || result?.providers || []
  } catch { /* fall back to env vars */ }
  const auth = await loadAuth()

  if (options.provider) {
    const pid = options.provider
    const provider = allProviders.find((p: any) => p.id === pid)
    const apiKey = (provider ? extractProviderApiKey(provider, auth) : "") || auth[pid]?.key || process.env.MULTIMODAL_API_KEY || ""
    const baseUrl = provider ? extractProviderBaseUrl(provider) : (BUILTIN_PROVIDERS[pid]?.api || "https://api.openai.com/v1")
    const isAnthropic = provider ? detectIsAnthropic(provider) : (BUILTIN_PROVIDERS[pid]?.isAnthropic || false)
    const model = options.model || (provider ? pickVisionModel(provider) || "gpt-4o" : "gpt-4o")
    return { providerId: pid, model, apiKey, baseUrl, isAnthropic }
  }

  // Auto-discovery: find first provider with key + vision model
  for (const provider of allProviders) {
    const apiKey = extractProviderApiKey(provider, auth)
    if (!apiKey) continue
    let model = pickVisionModel(provider)
    // If no vision model detected, try known defaults for this provider
    if (!model) {
      const defaults = DEFAULT_VISION_MODELS[provider.id] || []
      model = defaults[0] || null
    }
    if (!model) continue
    return {
      providerId: provider.id,
      model,
      apiKey,
      baseUrl: extractProviderBaseUrl(provider),
      isAnthropic: detectIsAnthropic(provider),
    }
  }

  const apiKey = env("MULTIMODAL_API_KEY", "")
  const baseUrl = env("MULTIMODAL_BASE_URL", "https://api.openai.com/v1")
  const model = env("MULTIMODAL_MODEL", "gpt-4o")
  return { providerId: "openai", model, apiKey, baseUrl, isAnthropic: false }
}

async function callAnthropicApi(base64: string, mediaType: string, config: ResolvedConfig, prompt?: string): Promise<DescribeResult> {
  let base = config.baseUrl || ""
  if (!base.startsWith("http")) {
    console.error(`[vision] Invalid baseUrl: "${base}", falling back to Anthropic`)
    base = "https://api.anthropic.com/v1"
  }
  const url = base.replace(/\/+$/, "") + "/messages"
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: prompt || DEFAULT_DESCRIBE_PROMPT },
        ],
      }],
    }),
  })
  const data = (await response.json()) as any
  if (data.error) throw new Error(`${config.providerId} API error: ${data.error.message}`)
  const text = data?.content?.[0]?.text
  if (!text) throw new Error(`${config.providerId} returned no content: ${JSON.stringify(data).slice(0, 300)}`)
  return {
    text,
    usage: { input: data?.usage?.input_tokens || 0, output: data?.usage?.output_tokens || 0 },
  }
}

async function callOpenAICompatibleApi(base64: string, mediaType: string, config: ResolvedConfig, prompt?: string): Promise<DescribeResult> {
  let base = config.baseUrl || ""
  if (!base.startsWith("http")) {
    console.error(`[vision] Invalid baseUrl: "${base}", falling back to OpenAI`)
    base = "https://api.openai.com/v1"
  }
  const url = base.replace(/\/+$/, "") + "/chat/completions"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  }
  if (config.providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/anomalyco/opencode"
    headers["X-Title"] = "opencode-multimodal-bridge"
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
          { type: "text", text: prompt || DEFAULT_DESCRIBE_PROMPT },
        ],
      }],
      max_tokens: 2048,
    }),
  })
  const data = (await response.json()) as any
  if (data.error) throw new Error(`${config.providerId} API error: ${data.error.message}`)
  // Reasoning models (e.g. gemini-*-pro-preview) return the answer in `content`,
  // but if the token budget is spent thinking, `content` is null and the text
  // lands in `reasoning`. Fall back to it so reasoning models still describe.
  const msg = data?.choices?.[0]?.message
  const text = msg?.content || msg?.reasoning || msg?.reasoning_content
  if (!text) throw new Error(`${config.providerId} returned no content: ${JSON.stringify(data).slice(0, 300)}`)
  return {
    text,
    usage: { input: data?.usage?.prompt_tokens || 0, output: data?.usage?.completion_tokens || 0 },
  }
}

async function describeBase64(base64: string, mediaType: string, config: ResolvedConfig, prompt?: string): Promise<DescribeResult> {
  if (config.isAnthropic) return callAnthropicApi(base64, mediaType, config, prompt)
  return callOpenAICompatibleApi(base64, mediaType, config, prompt)
}

async function describeFile(filePath: string, config: ResolvedConfig, prompt?: string): Promise<DescribeResult> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) throw new Error(`File not found: ${filePath}`)
  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString("base64")
  return describeBase64(base64, getMediaType(filePath), config, prompt)
}

// A persisted FilePart.url may be a data: URL, a file:// URL, or a plain path.
async function filePartToBase64(part: FilePart): Promise<{ base64: string; mime: string } | null> {
  const url = part.url || ""
  if (url.startsWith("data:")) {
    const ex = extractBase64FromDataUrl(url)
    if (ex) return ex
  }
  let path: string | null = null
  if (url.startsWith("file://")) path = decodeURIComponent(url.slice("file://".length))
  else if (url.startsWith("/")) path = url
  if (path) {
    const file = Bun.file(path)
    if (await file.exists()) {
      const arrayBuffer = await file.arrayBuffer()
      return { base64: Buffer.from(arrayBuffer).toString("base64"), mime: part.mime || getMediaType(path) }
    }
  }
  return null
}

async function loadPluginConfig(dir: string): Promise<Record<string, string> | null> {
  try {
    const file = Bun.file(`${dir}/ad-vision.json`)
    if (!(await file.exists())) return null
    return await file.json()
  } catch { return null }
}

export const AdVisionPlugin = async (ctx: any, options: any) => {
  const opts = (options || {}) as PluginOptions
  const describedFiles = new Set<string>()
  // Cache descriptions by FilePart.id — the messages.transform hook fires on
  // every step of the agent loop, so without this every tool turn re-describes.
  const descCache = new Map<string, string>()

  // Read config lazily — picks up changes from /ad-vision command
  const readCfg = async (): Promise<Record<string, string>> => {
    const [globalCfg, localCfg] = await Promise.all([
      loadPluginConfig(`${process.env.HOME}/.config/opencode`),
      loadPluginConfig(`${ctx.directory}/.opencode`),
    ])
    const c = { ...globalCfg, ...localCfg }
    if (process.env.VISION_ENABLED === "false") c.enabled = "false"
    if (process.env.VISION_ENABLED === "true") c.enabled = "true"
    return c
  }

  // Check disabled at boot (fast path)
  const bootCfg = await readCfg()
  if (bootCfg.enabled === "false") {
    console.log("[ad-vision] Disabled")
    return { tool: {} }
  }

  // Lazy config — reads ad-vision.json on first use, picks up changes from /ad-vision
  // Cache resolved config to avoid re-reading auth.json on every message
  let cachedConfig: ResolvedConfig | null = null
  let configPromise: Promise<ResolvedConfig> | null = null
  const getConfig = async (): Promise<ResolvedConfig> => {
    if (cachedConfig) return cachedConfig
    const cfg = await readCfg()
    if (cfg.model) {
      const pid = cfg.provider || "openai"
      const builtin = BUILTIN_PROVIDERS[pid]
      let key = ""
      let baseUrl = cfg.baseUrl || builtin?.api || ""
      try {
        const authFile = Bun.file(`${process.env.HOME}/.local/share/opencode/auth.json`)
        if (await authFile.exists()) {
          const auth = await authFile.json()
          key = auth[pid]?.key || ""
        }
      } catch { }
      if (!key) key = process.env.MULTIMODAL_API_KEY || ""
      if (!baseUrl) baseUrl = "https://api.openai.com/v1"
      cachedConfig = {
        providerId: pid,
        model: cfg.model,
        apiKey: key,
        baseUrl,
        isAnthropic: builtin?.isAnthropic || false,
      }
      return cachedConfig
    }
    if (!configPromise) configPromise = resolveConfig(opts, ctx.client, {})
    cachedConfig = await configPromise
    return cachedConfig
  }

  // Only surfaced for failures — success/progress is shown by the normal
  // assistant spinner while the transform hook blocks on the describe call.
  const showError = async (msg: string) => {
    try { await ctx.client.tui.showToast({ body: { message: msg, variant: "error", duration: 5000 } }) } catch { }
  }

  return {
    tool: {
      ad_describe_image: tool({
        description:
          "Describe an image file (screenshot, photo, diagram, etc.) by sending it to a multimodal AI model. " +
          "Use this tool whenever you encounter an image file and need to understand its contents. " +
          "Returns a detailed text description of what the image shows.",
        args: {
          path: tool.schema.string().describe("Absolute or relative path to the image file"),
          prompt: tool.schema.string().optional().describe("Custom prompt to focus the description"),
        },
        async execute(args: any, context: any) {
          const config = await getConfig()
          if (!config.apiKey) return `Error: No API key configured. Configure one in opencode.json.`
          const { path, prompt } = args
          const absolutePath = path.startsWith("/") ? path : `${context.directory}/${path}`
          if (!isImagePath(absolutePath)) return `Error: "${path}" is not a supported image format. Supported: ${[...IMAGE_EXTENSIONS].join(", ")}.`
          try {
            const result = await describeFile(absolutePath, config, prompt)
            await recordUsage(context.sessionID, config, result.usage)
            return result.text
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),
    },
    // Inject the priming note into the system prompt — invisible to the chat.
    "experimental.chat.system.transform": async (input: any, output: any) => {
      try {
        if (input.model?.capabilities?.input?.image) return
        if (isSessionModelMultimodal(input.model?.id)) return
        const config = await getConfig()
        if (!config.apiKey) return
        if (!output.system.includes(VISION_PRIME)) output.system.push(VISION_PRIME)
      } catch (err) {
        console.error("[ad-vision] system.transform hook error:", err)
      }
    },

    // Replace image file parts with text descriptions in the messages sent to
    // the model. These transformed messages are NOT persisted, so the chat keeps
    // showing the image as a file plaza while the model receives text only.
    "experimental.chat.messages.transform": async (_input: any, output: any) => {
      try {
        const messages = output.messages || []
        // Hook input carries no model — read it off the latest user message.
        let modelID = ""
        for (let i = messages.length - 1; i >= 0; i--) {
          const info = messages[i]?.info
          if (info?.role === "user" && info?.model?.modelID) { modelID = info.model.modelID; break }
        }
        if (isSessionModelMultimodal(modelID)) return
        const config = await getConfig()
        if (!config.apiKey) return

        for (const msg of messages) {
          if (msg?.info?.role !== "user" || !Array.isArray(msg.parts)) continue
          for (let i = 0; i < msg.parts.length; i++) {
            const part = msg.parts[i]
            if (part?.type !== "file" || !isImageMime(part.mime)) continue
            let description = descCache.get(part.id)
            if (!description) {
              const data = await filePartToBase64(part as FilePart)
              if (!data) continue
              try {
                const result = await describeBase64(data.base64, data.mime, config)
                description = result.text
                descCache.set(part.id, description)
                await recordUsage(msg.info.sessionID, config, result.usage)
              } catch (err) {
                console.error(`[ad-vision] Failed to describe image:`, err)
                showError(`Failed to describe image: ${err instanceof Error ? err.message : String(err)}`)
                continue
              }
            }
            msg.parts[i] = {
              id: part.id,
              sessionID: part.sessionID,
              messageID: part.messageID,
              type: "text",
              text: `[Image${part.filename ? `: ${part.filename}` : ""}]\n\n${description}`,
              synthetic: true,
            }
          }
        }
      } catch (err) {
        console.error("[ad-vision] messages.transform hook error:", err)
      }
    },
    "tool.execute.after": async (input: any, output: any) => {
      if (input.tool !== "read") return
      const args = input.args as Record<string, any> | undefined
      const filePath = args?.filePath
      if (!filePath || typeof filePath !== "string" || !isImagePath(filePath)) return
      if (describedFiles.has(filePath)) return
      const config = await getConfig()
      if (!config.apiKey) return
      describedFiles.add(filePath)
      try {
        const result = await describeFile(filePath, config)
        await recordUsage(input.sessionID, config, result.usage)
        output.output = `[Image described by vision plugin]\n\n${result.text}`
      } catch (err) {
        console.error(`[ad-vision] Failed to auto-describe ${filePath}:`, err)
        showError(`Failed to describe image: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}

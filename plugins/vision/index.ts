import type { Plugin } from "@opencode-ai/plugin"
import type { FilePart } from "@opencode-ai/sdk"
import { tool } from "@opencode-ai/plugin"

const VERSION = "0.2.0"

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
  "qwen-vl", "qwen2-vl", "qwen2.5-vl",
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

function extractProviderApiKey(provider: any): string {
  if (provider.options?.apiKey) return provider.options.apiKey
  if (provider.request?.body?.apiKey) return provider.request.body.apiKey
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
  openrouter: ["google/gemini-2.0-flash-exp:free", "qwen/qwen-vl-max", "openai/gpt-4o"],
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

async function resolveConfig(options: PluginOptions, client: any): Promise<ResolvedConfig> {
  let allProviders: any[] = []
  try {
    const result = await client.config.providers()
    allProviders = result?.data?.providers || result?.providers || []
  } catch { /* fall back to env vars */ }

  if (options.provider) {
    const pid = options.provider
    const provider = allProviders.find((p: any) => p.id === pid)
    const apiKey = provider ? extractProviderApiKey(provider) : process.env.MULTIMODAL_API_KEY || ""
    const baseUrl = provider ? extractProviderBaseUrl(provider) : (BUILTIN_PROVIDERS[pid]?.api || "https://api.openai.com/v1")
    const isAnthropic = provider ? detectIsAnthropic(provider) : (BUILTIN_PROVIDERS[pid]?.isAnthropic || false)
    const model = options.model || (provider ? pickVisionModel(provider) || "gpt-4o" : "gpt-4o")
    return { providerId: pid, model, apiKey, baseUrl, isAnthropic }
  }

  // Auto-discovery: find first provider with key + vision model
  for (const provider of allProviders) {
    const apiKey = extractProviderApiKey(provider)
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

  const apiKey = process.env.MULTIMODAL_API_KEY || ""
  const baseUrl = process.env.MULTIMODAL_BASE_URL || "https://api.openai.com/v1"
  const model = process.env.MULTIMODAL_MODEL || "gpt-4o"
  return { providerId: "openai", model, apiKey, baseUrl, isAnthropic: false }
}

async function callAnthropicApi(base64: string, mediaType: string, config: ResolvedConfig, prompt?: string): Promise<string> {
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
  return text
}

async function callOpenAICompatibleApi(base64: string, mediaType: string, config: ResolvedConfig, prompt?: string): Promise<string> {
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
  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error(`${config.providerId} returned no content: ${JSON.stringify(data).slice(0, 300)}`)
  return text
}

async function describeBase64(base64: string, mediaType: string, config: ResolvedConfig, prompt?: string): Promise<string> {
  if (config.isAnthropic) return callAnthropicApi(base64, mediaType, config, prompt)
  return callOpenAICompatibleApi(base64, mediaType, config, prompt)
}

async function describeFile(filePath: string, config: ResolvedConfig, prompt?: string): Promise<string> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) throw new Error(`File not found: ${filePath}`)
  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString("base64")
  return describeBase64(base64, getMediaType(filePath), config, prompt)
}

export const VisionPlugin = async (ctx: any, options: any) => {
  const disabledEnv = process.env.VISION_ENABLED
  if (disabledEnv === "false" || disabledEnv === "0") {
    console.log("[vision] Disabled via VISION_ENABLED=false")
    return { tool: {} }
  }

  const opts = (options || {}) as PluginOptions
  const describedFiles = new Set<string>()
  const primedSessions = new Set<string>()

  // Lazy config — resolves on first use, prevents blocking at startup
  let configPromise: Promise<ResolvedConfig> | null = null
  const getConfig = () => {
    if (!configPromise) configPromise = resolveConfig(opts, ctx.client)
    return configPromise
  }

  const showToast = async (msg: string, variant: string, duration: number) => {
    try { await ctx.client.tui.showToast({ body: { message: msg, variant, duration } }) } catch { }
  }

  // Fire-and-forget: resolve config in background for early toast
  getConfig().then((config) => {
    if (!config.apiKey) {
      console.warn(
        `[multimodal-bridge] No vision provider found. ` +
        `Configure one in opencode.json → provider.<id>.options.apiKey. ` +
        `Supported: openai, anthropic, openrouter, groq, deepseek, together, fireworks, xai.`
      )
      showToast("[vision] No API key configured", "warning", 8000)
    } else if (!opts.provider) {
      showToast(`Vision: ${config.providerId}/${config.model} (v${VERSION})`, "info", 4000)
    }
  })

  return {
    tool: {
      describe_image: tool({
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
            return await describeFile(absolutePath, config, prompt)
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),
    },
    "chat.message": async (_input: any, output: any) => {
      // Skip if the session model already supports images natively
      if (isSessionModelMultimodal(_input.model?.modelID)) return
      const config = await getConfig()
      if (!config.apiKey) return
      const imageParts = output.parts.filter(
        (p: any) => p.type === "file" && isImageMime((p as FilePart).mime),
      ) as FilePart[]
      if (imageParts.length === 0) return
      if (!primedSessions.has(_input.sessionID)) {
        primedSessions.add(_input.sessionID)
        output.parts.unshift({
          id: `${_input.id}_vision_prime`,
          sessionID: _input.sessionID,
          messageID: _input.messageID,
          type: "text",
          text: VISION_PRIME,
          synthetic: true,
        })
      }
      for (const part of imageParts) {
        try {
          const extracted = extractBase64FromDataUrl(part.url)
          if (!extracted) continue
          const description = await describeBase64(extracted.base64, extracted.mime, config)
          output.parts.push({
            id: `${part.id}_desc`,
            sessionID: part.sessionID,
            messageID: part.messageID,
            type: "text",
            text: `[Image${part.filename ? `: ${part.filename}` : ""}]\n\n${description}`,
            synthetic: true,
          })
        } catch (err) {
          console.error(`[multimodal-bridge] Failed to describe pasted image:`, err)
        }
      }
    },
    "tool.execute.after": async (input: any, output: any) => {
      if (!config.apiKey) return
      if (input.tool !== "read") return
      const args = input.args as Record<string, any> | undefined
      const filePath = args?.filePath
      if (!filePath || typeof filePath !== "string" || !isImagePath(filePath)) return
      if (describedFiles.has(filePath)) return
      describedFiles.add(filePath)
      try {
        const description = await describeFile(filePath, config)
        output.output = `[Image described by vision plugin]\n\n${description}`
      } catch (err) {
        console.error(`[multimodal-bridge] Failed to auto-describe ${filePath}:`, err)
      }
    },
  }
}

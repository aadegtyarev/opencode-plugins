import type { Plugin } from "@opencode-ai/plugin"
import type { FilePart } from "@opencode-ai/sdk"
import { tool } from "@opencode-ai/plugin"

// ── Types ────────────────────────────────────────────────────────────

interface PluginOptions {
  /** opencode provider ID to use for vision (e.g. "openai", "anthropic", "openrouter") */
  provider?: string
  /** Model ID for the vision model (defaults to first model that supports images) */
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
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".tiff", ".tif", ".avif", ".pdf",
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
  ".pdf": "application/pdf",
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

const IMAGE_MIME_PREFIXES = ["image/", "application/pdf"]

function isImageMime(mime: string): boolean {
  return IMAGE_MIME_PREFIXES.some((p) => mime.startsWith(p))
}

// ── Built-in provider defaults ───────────────────────────────────────

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

// ── Config resolution ────────────────────────────────────────────────

function extractProviderApiKey(provider: any): string {
  // 1. Explicit apiKey in options
  if (provider.options?.apiKey) return provider.options.apiKey
  // 2. Check env vars listed by the provider
  if (Array.isArray(provider.env)) {
    for (const envVar of provider.env) {
      const val = process.env[envVar]
      if (val) return val
    }
  }
  // 3. Common fallback env vars
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY"]) {
    const val = process.env[key]
    if (val) return val
  }
  return ""
}

function extractProviderBaseUrl(provider: any): string {
  if (provider.options?.baseURL) return provider.options.baseURL
  if (provider.api) return provider.api
  // Resolve from built-in defaults
  const builtin = BUILTIN_PROVIDERS[provider.id]
  if (builtin) return builtin.api
  return ""
}

function detectIsAnthropic(provider: any): boolean {
  const builtin = BUILTIN_PROVIDERS[provider.id]
  if (builtin) return builtin.isAnthropic
  const apiField = provider.api || provider.options?.api
  if (typeof apiField === "string" && apiField.includes("anthropic")) return true
  return false
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

async function resolveConfig(
  options: PluginOptions,
  client: any,
): Promise<ResolvedConfig> {
  // Fetch all configured providers from opencode
  let allProviders: any[] = []
  try {
    const result = await client.config.providers()
    allProviders = result?.data?.providers || result?.providers || []
  } catch { /* will fall back to env vars */ }

  // ── If user specified a provider in plugin options, use it ──────
  if (options.provider) {
    const pid = options.provider
    const provider = allProviders.find((p: any) => p.id === pid)
    const apiKey = provider ? extractProviderApiKey(provider) : process.env.MULTIMODAL_API_KEY || ""
    const baseUrl = provider ? extractProviderBaseUrl(provider) : (BUILTIN_PROVIDERS[pid]?.api || "https://api.openai.com/v1")
    const isAnthropic = provider ? detectIsAnthropic(provider) : (BUILTIN_PROVIDERS[pid]?.isAnthropic || false)
    const model = options.model || (provider ? pickVisionModel(provider) || "gpt-4o" : "gpt-4o")
    return { providerId: pid, model, apiKey, baseUrl, isAnthropic }
  }

  // ── Auto-discovery: find first provider with key + vision model ──
  for (const provider of allProviders) {
    const apiKey = extractProviderApiKey(provider)
    if (!apiKey) continue
    const model = pickVisionModel(provider)
    if (!model) continue
    return {
      providerId: provider.id,
      model,
      apiKey,
      baseUrl: extractProviderBaseUrl(provider),
      isAnthropic: detectIsAnthropic(provider),
    }
  }

  // ── Fallback: env vars ──────────────────────────────────────────
  const apiKey = process.env.MULTIMODAL_API_KEY || ""
  const baseUrl = process.env.MULTIMODAL_BASE_URL || "https://api.openai.com/v1"
  const model = process.env.MULTIMODAL_MODEL || "gpt-4o"
  return { providerId: "openai", model, apiKey, baseUrl, isAnthropic: false }
}

// ── API calls ────────────────────────────────────────────────────────

async function callAnthropicApi(base64: string, mediaType: string, config: ResolvedConfig, prompt?: string): Promise<string> {
  // Anthropic's host for /v1/messages
  const url = config.baseUrl.replace(/\/+$/, "") + "/messages"
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
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
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
  const url = config.baseUrl.replace(/\/+$/, "") + "/chat/completions"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  }
  // OpenRouter-specific headers (harmless for others)
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
  if (config.isAnthropic) {
    return callAnthropicApi(base64, mediaType, config, prompt)
  }
  return callOpenAICompatibleApi(base64, mediaType, config, prompt)
}

async function describeFile(filePath: string, config: ResolvedConfig, prompt?: string): Promise<string> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    throw new Error(`File not found: ${filePath}`)
  }
  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString("base64")
  return describeBase64(base64, getMediaType(filePath), config, prompt)
}

// ── Plugin ───────────────────────────────────────────────────────────

export const MultimodalBridge: Plugin = async (ctx, options) => {
  const opts = (options || {}) as PluginOptions
  const config = await resolveConfig(opts, ctx.client)
  const describedFiles = new Set<string>()
  const primedSessions = new Set<string>()

  if (!config.apiKey) {
    const msg =
      `[multimodal-bridge] No vision provider found. ` +
      `Configure one in opencode.json → provider.<id>.options.apiKey. ` +
      `Supported: openai, anthropic, openrouter, groq, deepseek, together, fireworks, xai.`
    console.warn(msg)
    try {
      await ctx.client.tui.showToast({
        body: { message: msg, variant: "warning", duration: 8000 },
      })
    } catch { /* TUI might not be available */ }
  } else if (!opts.provider) {
    // Auto-discovered — let the user know
    const msg = `Vision: ${config.providerId}/${config.model}`
    try {
      await ctx.client.tui.showToast({
        body: { message: msg, variant: "info", duration: 4000 },
      })
    } catch { /* TUI might not be available */ }
  }

  return {
    // ── Custom tool ────────────────────────────────────────────────
    tool: {
      describe_image: tool({
        description:
          "Describe an image file (screenshot, photo, diagram, etc.) by sending it to a multimodal AI model via " +
          `the configured provider (${config.providerId}/${config.model}). ` +
          "Use this tool whenever you encounter an image file and need to understand its contents. " +
          "Returns a detailed text description of what the image shows.",
        args: {
          path: tool.schema
            .string()
            .describe("Absolute or relative path to the image file"),
          prompt: tool.schema
            .string()
            .optional()
            .describe("Custom prompt to focus the description (e.g. 'What error is shown?' or 'Read all text')"),
        },
        async execute(args, context) {
          if (!config.apiKey) {
            return `Error: No API key configured for vision provider "${config.providerId}". Configure it in opencode.json.`
          }
          const { path, prompt } = args
          const absolutePath = path.startsWith("/") ? path : `${context.directory}/${path}`
          if (!isImagePath(absolutePath)) {
            return `Error: "${path}" is not a supported image format. Supported: ${[...IMAGE_EXTENSIONS].join(", ")}.`
          }
          try {
            return await describeFile(absolutePath, config, prompt)
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),
    },

    // ── Auto-describe images pasted/dropped in chat ─────────────────
    "chat.message": async (_input, output) => {
      if (!config.apiKey) return

      const imageParts = output.parts.filter(
        (p) => p.type === "file" && isImageMime((p as FilePart).mime),
      ) as FilePart[]

      if (imageParts.length === 0) return

      // Prime the model about vision capabilities (once per session)
      if (!primedSessions.has(_input.sessionID)) {
        primedSessions.add(_input.sessionID)
        output.parts.unshift({
          id: `${_input.id}_vision_prime`,
          sessionID: _input.sessionID,
          messageID: _input.messageID,
          type: "text",
          text: VISION_PRIME,
          synthetic: true,
        } as any)
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
          } as any)
        } catch (err) {
          console.error(`[multimodal-bridge] Failed to describe pasted image:`, err)
        }
      }
    },

    // ── Auto-describe images when `read` tool reads them ────────────
    "tool.execute.after": async (input) => {
      if (!config.apiKey) return
      if (input.tool !== "read") return
      const args = input.args as Record<string, any> | undefined
      const filePath = args?.filePath
      if (!filePath || typeof filePath !== "string" || !isImagePath(filePath)) return
      if (describedFiles.has(filePath)) return
      describedFiles.add(filePath)
      try {
        const description = await describeFile(filePath, config)
        await ctx.client.session.prompt({
          path: { id: input.sessionID },
          body: {
            noReply: true,
            parts: [{
              type: "text",
              text: `[Auto-described image: ${filePath}]\n\n${description}`,
            }],
          },
        })
      } catch (err) {
        console.error(`[multimodal-bridge] Failed to auto-describe ${filePath}:`, err)
      }
    },
  }
}

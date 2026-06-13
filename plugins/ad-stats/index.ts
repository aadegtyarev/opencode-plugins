import { type Plugin, tool } from "@opencode-ai/plugin"

const VERSION = "1.1.0"

// Token-usage ledger written by the ad-vision plugin. The vision model is called
// over raw HTTP, so its usage never reaches opencode's message events — we read
// this file to fold those tokens in. Keep the path in sync with ad-vision/index.ts.
const USAGE_LEDGER = `${process.env.HOME}/.local/share/opencode/ad-vision-usage.jsonl`

interface ModelStats {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
  messages: number
}

const storage = new Map<string, Map<string, ModelStats>>()

// Read the vision ledger and aggregate per model key for one session.
async function readVisionUsage(sessionID: string): Promise<Map<string, ModelStats>> {
  const out = new Map<string, ModelStats>()
  try {
    const file = Bun.file(USAGE_LEDGER)
    if (!(await file.exists())) return out
    const text = await file.text()
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      let r: any
      try { r = JSON.parse(line) } catch { continue }
      if (r.sessionID !== sessionID) continue
      const key = `${r.providerID}/${r.model}`
      const s = ensure(key, out)
      s.input += r.input || 0
      s.output += r.output || 0
      s.messages++
    }
  } catch { /* ignore unreadable ledger */ }
  return out
}

function ensure(key: string, map: Map<string, ModelStats>): ModelStats {
  let s = map.get(key)
  if (!s) {
    s = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0 }
    map.set(key, s)
  }
  return s
}

function fmt(n: number): string {
  if (!isFinite(n)) return "0"
  try { return n.toLocaleString("en-US") } catch { return String(n) }
}

function pct(part: number, total: number): string {
  if (total === 0) return "0.0%"
  return ((part / total) * 100).toFixed(1) + "%"
}

export const AdStatsPlugin: Plugin = async () => {
  // Track last values per message — allows updating without double-counting
  const lastValues = new Map<string, { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; cost: number }>()
  let eventCount = 0
  let msgCount = 0
  const receivedTypes = new Set<string>()
  
  return {
    event: async ({ event }) => {
      try {
        eventCount++
        receivedTypes.add(event.type)
        if (event.type === "message.updated") {
        const msg = event.properties.info
        msgCount++
        if (msg.role !== "assistant") return

        const key = `${msg.providerID}/${msg.modelID}`
        let session = storage.get(msg.sessionID)
        if (!session) {
          session = new Map()
          storage.set(msg.sessionID, session)
        }
        const s = ensure(key, session)

        // Delta tracking: subtract previous values, add new values
        const prev = lastValues.get(msg.id) || { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
        const cur = {
          input: msg.tokens?.input || 0,
          output: msg.tokens?.output || 0,
          reasoning: msg.tokens?.reasoning || 0,
          cacheRead: msg.tokens?.cache?.read || 0,
          cacheWrite: msg.tokens?.cache?.write || 0,
          cost: msg.cost || 0,
        }
        s.input += cur.input - prev.input
        s.output += cur.output - prev.output
        s.reasoning += cur.reasoning - prev.reasoning
        s.cacheRead = cur.cacheRead  // cache is cumulative per message, use latest
        s.cacheWrite = cur.cacheWrite
        s.cost += cur.cost - prev.cost
        if (prev.input === 0 && cur.input > 0) s.messages++  // count only first real update
        lastValues.set(msg.id, cur)
      }

        if (event.type === "session.deleted") {
          const id = event.properties.info.id
          storage.delete(id)
          // Drop this session's rows from the vision ledger so it doesn't grow forever.
          try {
            const file = Bun.file(USAGE_LEDGER)
            if (await file.exists()) {
              const kept = (await file.text())
                .split("\n")
                .filter((line) => {
                  if (!line.trim()) return false
                  try { return JSON.parse(line).sessionID !== id } catch { return false }
                })
              await Bun.write(USAGE_LEDGER, kept.length ? kept.join("\n") + "\n" : "")
            }
          } catch { /* ignore */ }
        }
      } catch { /* skip malformed events */ }
    },

    tool: {
      ad_token_stats: tool({
        description:
          "Show token usage statistics for the current OpenCode session, broken down by model (provider/model). Call this when the user asks about token consumption, costs, usage statistics, or how many tokens they have used.",
        args: {},
        async execute(_, context) {
          try {
            // Merge the main-model stats (from message events) with vision-model
            // usage (from the ledger) into one per-model view.
            const session = new Map<string, ModelStats>()
            for (const [key, s] of storage.get(context.sessionID) || []) {
              session.set(key, { ...s })
            }
            for (const [key, v] of await readVisionUsage(context.sessionID)) {
              const s = ensure(key, session)
              s.input += v.input
              s.output += v.output
              s.reasoning += v.reasoning
              s.cost += v.cost
              s.messages += v.messages
            }
          if (session.size === 0) {
            return `No token data yet. Events: ${eventCount} total (${[...receivedTypes].join(", ") || "none"}), ${msgCount} messages.`
          }

          let totalInput = 0
          let totalOutput = 0
          let totalReasoning = 0
          let totalCacheRead = 0
          let totalCacheWrite = 0
          let totalCost = 0
          let totalMsgs = 0

          for (const [, s] of session) {
            totalInput += s.input
            totalOutput += s.output
            totalReasoning += s.reasoning
            totalCacheRead += s.cacheRead
            totalCacheWrite += s.cacheWrite
            totalCost += s.cost
            totalMsgs += s.messages
          }

          const modelEntries = [...session.entries()].sort(([, a], [, b]) => b.cost - a.cost)

          const lines: string[] = []
          const totalTokens = totalInput + totalOutput + totalReasoning

          lines.push(`Token Usage — Session ${context.sessionID.slice(0, 8)}...`)
          lines.push(`Messages: ${totalMsgs}  Tokens: ${fmt(totalTokens)}  Cache: ${fmt(totalCacheRead)}r / ${fmt(totalCacheWrite)}w  Cost: $${totalCost.toFixed(4)}`)
          lines.push("─".repeat(60))

          for (const [model, s] of modelEntries) {
            const modelTokens = s.input + s.output + s.reasoning
            lines.push(`${model}`)
            lines.push(`  Input:     ${String(fmt(s.input)).padStart(10)}  Output:   ${String(fmt(s.output)).padStart(10)}  Reasoning: ${String(fmt(s.reasoning)).padStart(8)}`)
            lines.push(`  Cache:     ${String(fmt(s.cacheRead) + "r").padStart(10)}  Cache w:  ${String(fmt(s.cacheWrite) + "w").padStart(10)}  Messages:  ${String(s.messages).padStart(6)}`)
            lines.push(`  Subtotal:  ${String(fmt(modelTokens)).padStart(10)} tokens  Cost:     $${s.cost.toFixed(4)}`)
            lines.push("")
          }

          return lines.join("\n")
          } catch (err: any) {
            return `Error: ${err?.message || err}`
          }
        },
      }),
    },
  }
}

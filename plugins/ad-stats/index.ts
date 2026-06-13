import { type Plugin, tool } from "@opencode-ai/plugin"

const VERSION = "1.0.0"

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
  
  return {
    event: async ({ event }) => {
      try {
        if (event.type === "message.updated") {
        const msg = event.properties.info
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
            const session = storage.get(context.sessionID)
          if (!session || session.size === 0) {
            return "No token usage data recorded for this session yet. Send a message and wait for a response to start collecting stats."
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

          lines.push(`## Token Usage`)
          lines.push(
            `**Session:** \`${context.sessionID.slice(0, 8)}...\`  |  **Messages:** ${totalMsgs}  |  **Tokens:** ${fmt(totalTokens)}  |  **Cache:** r${fmt(totalCacheRead)} / w${fmt(totalCacheWrite)}  |  **Cost:** $${totalCost.toFixed(4)}`,
          )
          lines.push("")

          for (const [model, s] of modelEntries) {
            const modelTokens = s.input + s.output + s.reasoning
            lines.push(`### ${model}`)
            lines.push(`| Metric | Value |`)
            lines.push(`|--------|-------|`)
            lines.push(`| Messages | ${s.messages} |`)
            lines.push(`| Input tokens | ${fmt(s.input)} |`)
            lines.push(`| Output tokens | ${fmt(s.output)} |`)
            lines.push(`| Reasoning tokens | ${fmt(s.reasoning)} |`)
            lines.push(`| Cache read | ${fmt(s.cacheRead)} (${pct(s.cacheRead, s.input)}) |`)
            lines.push(`| Cache write | ${fmt(s.cacheWrite)} (${pct(s.cacheWrite, s.input)}) |`)
            lines.push(`| **Subtotal** | **${fmt(modelTokens)} tokens** |`)
            lines.push(`| **Cost** | **$${s.cost.toFixed(4)}** |`)
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

# opencode-plugins

A collection of plugins for [OpenCode](https://github.com/anomalyco/opencode). Install all at once or pick what you need.

All plugins use `ad-` prefix to avoid conflicts.

## Install

```bash
npx github:aadegtyarev/opencode-plugins                 # interactive: pick target + plugins
npx github:aadegtyarev/opencode-plugins ad-vision       # only vision
npx github:aadegtyarev/opencode-plugins ad-vision ad-stats  # multiple
```

Flags:

```bash
--local   Install into project .opencode/
--global  Install into ~/.config/opencode/
--help    Show help
```

The installer:
- Copies plugin files into `plugins/`
- Adds `@opencode-ai/plugin` to `package.json` and runs `npm install`
- Detects a local project by the presence of `.opencode/` or `opencode.json`

Plugins placed in `.opencode/plugins/` are auto-loaded — no config changes needed.

---

## Plugins

### ad-vision — multimodal-bridge

Multimodality for any text model via a separate vision model.

**How it works:** when a message reaches the model, each image is sent to a vision model and replaced by its text description in what the model receives — invisibly. The image stays in the chat as a normal file attachment, and the work runs under the usual assistant spinner. The primary model "sees" images without native vision support.

**Why transform hooks:** the description is injected via `experimental.chat.messages.transform` (per-message) and the vision-priming note via `experimental.chat.system.transform`. These modify only what's sent to the model and are **not persisted to the chat** — so the image isn't buried under a wall of injected text, and the message isn't blocked from rendering while the vision model works. Descriptions are cached per image so the second model is called once, not on every tool turn.

**Zero-config:** auto-discovers a vision-capable provider.

**Vision-priming:** injects a system-prompt note telling the model it has vision capabilities. **Skips automatically** if the session model already supports vision natively (gpt-4o, claude-3+, gemini, qwen-vl, etc.).

**Token accounting:** vision-model calls go over raw HTTP and bypass opencode's usage events, so the plugin logs their token usage to a shared ledger (`~/.local/share/opencode/ad-vision-usage.jsonl`) that **ad-stats** reads — both models then show up in `/ad-tokens`.

**Supported providers:** OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Together, Fireworks, xAI + any OpenAI-compatible API.

**Hooks:** `experimental.chat.messages.transform` (images → descriptions), `experimental.chat.system.transform` (priming), `tool.execute.after` on `read` (file reads), `ad_describe_image` tool (explicit).

**Formats:** PNG, JPEG, GIF, WebP, BMP, SVG, ICO, TIFF, AVIF.

**Config:** `.opencode/ad-vision.json` (local) or `~/.config/opencode/ad-vision.json` (global):

```json
{
  "provider": "openrouter",
  "model": "qwen/qwen3-vl-32b-instruct",
  "enabled": true
}
```

`provider` and `baseUrl` are derived from opencode config — model is the only required field.
Use `/ad-vision` command for setup, `VISION_ENABLED=false` env to disable.

**Commands:**

| Command | Description |
|---|---|
| `/ad-vision` | Show/setup vision config |
| `/ad-vision-toggle` | Enable/disable |

---

### ad-stats — token usage tracker

Tracks token usage and costs per session, grouped by model.

**Tool:** `ad_token_stats` — input/output/reasoning tokens, cache hits, costs per model.

**Command:** `/ad-tokens` — show stats for current session.

**Vision model included:** folds in the **ad-vision** vision-model usage from the shared ledger (`~/.local/share/opencode/ad-vision-usage.jsonl`), so a session running a text model + a vision model shows both. Ledger rows are dropped when a session is deleted.

---

## Repo structure

```
plugins/
  ad-vision/
    index.ts        ← plugin code
    commands/       ← slash commands
  ad-stats/
    index.ts        ← plugin code
    commands/       ← slash commands
install.mjs         ← universal installer
package.json
skills/             ← agent skills
```

To add a new plugin, create `plugins/ad-<name>/index.ts` — the installer picks it up automatically.

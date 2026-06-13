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

**How it works:** intercepts images, sends them to a vision model, injects text description into context. Primary model "sees" images without native vision support.

**Zero-config:** auto-discovers a vision-capable provider. Toast on startup: `Vision: openrouter/... (v0.2.0)`.

**Vision-priming:** on first image in session, injects a note telling the model it has vision capabilities.

**Supported providers:** OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Together, Fireworks, xAI + any OpenAI-compatible API.

**Hooks:** `chat.message` (pasted images), `tool.execute.after` on `read` (file reads), `ad_describe_image` tool (explicit).

**Formats:** PNG, JPEG, GIF, WebP, BMP, SVG, ICO, TIFF, AVIF.

**Config:** `.opencode/.env` or `~/.config/opencode/.env`:

```env
# ad-vision plugin config (API key auto-read from opencode auth)
MULTIMODAL_PROVIDER=openrouter
MULTIMODAL_MODEL=qwen/qwen3.7-plus
MULTIMODAL_BASE_URL=https://openrouter.ai/api/v1
VISION_ENABLED=true
```

Without config, auto-discovers from opencode providers.

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

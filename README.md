# opencode-plugins

A collection of plugins for [OpenCode](https://github.com/anomalyco/opencode). Install all at once or pick what you need.

## Install

```bash
npx github:aadegtyarev/opencode-plugins              # interactive: pick target + plugins
npx github:aadegtyarev/opencode-plugins vision       # non-interactive: specific plugins
npx github:aadegtyarev/opencode-plugins vision foo   # multiple
```

Flags:

```bash
npx github:aadegtyarev/opencode-plugins --local      # force project install (.opencode/)
npx github:aadegtyarev/opencode-plugins --global     # force global install (~/.config/opencode/)
npx github:aadegtyarev/opencode-plugins --help       # show help
```

The installer:
- Copies plugin files into `plugins/`
- Adds `@opencode-ai/plugin` to `package.json` and runs `npm install`
- Detects a local project by the presence of `.opencode/` or `opencode.json`

**Plugins placed in `.opencode/plugins/` are auto-loaded by OpenCode — no config changes needed.**

---

## Plugins

### vision — multimodal-bridge

Multimodality for any text model via a separate vision model.

**How it works:** the plugin intercepts images, sends them to a vision model, and injects the text description into the context. Your primary model "sees" images even without native vision support.

**Zero-config:** auto-discovers a vision-capable provider from your opencode config. Shows a toast on startup: `Vision: openrouter/google/gemini-2.0-flash-exp:free`.

**Vision-priming:** on the first image in a session, injects a note telling the text model it has vision capabilities and to trust the provided descriptions. Models like DeepSeek stop refusing and start using the image descriptions.

**Supported providers:** OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Together, Fireworks, xAI + any OpenAI-compatible API.

**Three interception hooks:**
| Hook | When |
|---|---|
| `chat.message` | Image pasted/dropped in chat |
| `tool.execute.after` on `read` | Agent reads an image file |
| `describe_image` tool | Explicit call |

**Formats:** PNG, JPEG, GIF, WebP, BMP, SVG, ICO, TIFF, AVIF.

**Config:** auto-discovers a vision provider from your opencode config. Override with env vars:

```bash
export MULTIMODAL_API_KEY=sk-...       # API key
export MULTIMODAL_MODEL=gpt-4o         # model ID
export MULTIMODAL_BASE_URL=https://...  # optional, API base URL
```

**Enable/disable:**
```bash
export VISION_ENABLED=true    # enable
export VISION_ENABLED=false   # disable
```

---

## Repo structure

```
plugins/
  vision/
    index.ts        ← plugin code
install.mjs         ← universal installer
package.json        ← npm package
```

Each plugin is a folder under `plugins/`. The folder name is the plugin file name. To add a new plugin, create `plugins/<name>/index.ts` — the installer picks it up automatically.

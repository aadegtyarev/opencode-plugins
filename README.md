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

The installer automatically:
- Copies plugin files into `plugins/`
- Adds `@opencode-ai/plugin` to `package.json` and runs `npm install`
- Registers plugins in the `plugin` array of `opencode.json`/`.jsonc`
- Detects a local project by the presence of `.opencode/` or `opencode.json`

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

**Config (optional):**

```json
{
  "plugin": [
    ["vision", {
      "provider": "openrouter",
      "model": "google/gemini-2.0-flash-exp:free"
    }]
  ]
}
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

Each plugin is a folder under `plugins/`. The folder name is the plugin name in `opencode.json`. To add a new plugin, create `plugins/<name>/index.ts` — the installer picks it up automatically.

---
description: Write and debug OpenCode plugins — tools, hooks, commands, local vs npm loading
---

# OpenCode Plugin Writing Guide

## Plugin structure

A plugin is a `.ts` or `.js` file exporting a **named** async function:

```ts
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (ctx) => {
  return {
    // hooks go here
  }
}
```

The plugin function receives `ctx`:
- `ctx.client` — SDK client (call `client.config.providers()`, `client.session.prompt()`, etc.)
- `ctx.directory` — project working directory
- `ctx.project` — project info
- `ctx.$` — Bun shell

## Loading modes

| Mode | How | Config needed |
|---|---|---|
| **Local** | Copy to `.opencode/plugins/my-plugin.ts` | No — auto-loaded |
| **Global** | Copy to `~/.config/opencode/plugins/my-plugin.ts` | No — auto-loaded |
| **npm** | `npm publish`, add to `opencode.json` `plugin` array | Yes — `"plugin": ["pkg-name"]` |

Local/global plugins receive no config options. Use **env vars** or **`.env` files** instead.

## Hooks

Plugins return an object with hooks. Common ones:

```ts
return {
  // Add custom tools chat agents can call
  tool: {
    mytool: tool({
      description: "What this tool does",
      args: {
        name: tool.schema.string().describe("Description"),
      },
      async execute(args, context) {
        return `Result for ${args.name}`
      },
    }),
  },

  // Intercept chat messages BEFORE they're sent to LLM
  "chat.message": async (input, output) => {
    // input.sessionID, input.model, input.agent
    // output.parts — modify/add parts here
  },

  // Hook after a tool executes (e.g. read, bash)
  "tool.execute.after": async (input, output) => {
    // input.tool, input.sessionID, input.args
    // output.output — can modify tool output text
  },

  // Hook BEFORE a tool executes — can modify args
  "tool.execute.before": async (input, output) => {
    // output.args — modify arguments
  },

  // Inject env vars into shell sessions
  "shell.env": async (input, output) => {
    output.env.MY_VAR = "value"
  },
}
```

Full hooks list: `tool.execute.before`, `tool.execute.after`, `chat.message`, `chat.params`, `chat.headers`, `shell.env`, `permission.ask`, `event`, `command.execute.before`, plus experimental hooks (`experimental.session.compacting`, `experimental.chat.system.transform`, etc.)

## Slash commands

Commands are `.md` files in `.opencode/commands/`:

```markdown
---
description: What the command does
agent: build               # optional, which agent to use
model: openai/gpt-4o       # optional, override model
---
The prompt text sent to the LLM.
Use $ARGUMENTS for user input.
```

Or defined in `opencode.json`:
```json
{ "command": { "mycmd": { "template": "...", "description": "..." } } }
```

## Dependencies

Local plugins that need npm packages: add them to `.opencode/package.json`:
```json
{ "dependencies": { "some-pkg": "^1.0.0" } }
```
OpenCode runs `bun install` at startup.

## Debugging

Launch with `--print-logs --log-level DEBUG`:
```bash
opencode --print-logs --log-level DEBUG
```
Watch for `failed to load plugin` errors.

## Installer pattern

Publish a multi-plugin installer via npx from GitHub:

1. `package.json` with `"bin": "./install.mjs"` — makes it npx-executable
2. `install.mjs` — copies `.ts` files to `.opencode/plugins/`, sets up package.json, copies `commands/*.md`
3. User runs: `npx github:user/repo plugin-name`

## Common gotchas

- **Export must be named** (`export const X = async ...`), not default
- **Local plugins auto-load** — no `opencode.json` entry needed
- **Config via env vars** or a dedicated JSON config file (e.g. `.opencode/ad-vision.json`). Avoid `.env` for plugin settings — use a namespaced JSON config read via `Bun.file().json()`.
- **API keys** are in `~/.local/share/opencode/auth.json` — read directly, never store in plugin configs
- **Don't block at startup** — lazy-load providers, use `await` sparingly in init
- **API keys** are in `~/.local/share/opencode/auth.json` (read directly for fast access)
- **TypeScript** works but keep types minimal — runtime is Bun
- **`Bun.file()`** and `Bun.write()` for file I/O in plugins
- **Tool names** must not collide with opencode builtins (e.g. `token_usage` is reserved)
- **Hooks for all tools** (`tool.execute.after`, `tool.execute.before`) must early-return BEFORE async work — otherwise they break other plugins' tools
- **Closure variables**: if a hook references a variable like `config`, declare/await it in that hook

## Naming convention

Use `ad-` prefix for all plugin artifacts to avoid conflicts:

| What | Pattern | Example |
|---|---|---|
| Plugin dir | `plugins/ad-<name>/` | `plugins/ad-vision/` |
| Plugin file | `ad-<name>.ts` | `ad-vision.ts` |
| Export name | `Ad<Name>Plugin` | `AdVisionPlugin` |
| Tool IDs | `ad_<name>` | `ad_describe_image` |
| Commands | `/ad-<name>` | `/ad-vision`, `/ad-vision-toggle` |
| Command files | `ad-<name>.md` | `ad-vision.md` |

One style: hyphens for user-facing names (files, folders, commands), underscores for code identifiers (tool IDs).

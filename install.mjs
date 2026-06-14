#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
import { homedir } from "node:os"
import { createInterface, emitKeypressEvents } from "node:readline"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"))
const GLOBAL_DIR = join(homedir(), ".config", "opencode")
const PLUGINS_SRC = join(__dirname, "plugins")

// ── Helpers ───────────────────────────────────────────────────────────

function findConfig(dir) {
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return null
}

// ── Plugin discovery ──────────────────────────────────────────────────

function discoverPlugins() {
  const plugins = new Map()
  if (!existsSync(PLUGINS_SRC)) return plugins
  for (const entry of readdirSync(PLUGINS_SRC)) {
    const full = join(PLUGINS_SRC, entry)
    if (!statSync(full).isDirectory()) continue
    const files = []
    for (const f of readdirSync(full)) {
      if (f.endsWith(".ts") || f.endsWith(".js")) files.push(f)
    }
    if (files.length === 0) continue
    plugins.set(entry, { name: entry, dir: full, files })
  }
  return plugins
}

// ── Install logic ─────────────────────────────────────────────────────

function installPlugin(meta, targetPluginsDir, dataDir) {
  const dest = join(targetPluginsDir, `${meta.name}.ts`)
  const srcName = meta.files.includes("index.ts") ? "index.ts" : meta.files[0]
  mkdirSync(targetPluginsDir, { recursive: true })
  writeFileSync(dest, readFileSync(join(meta.dir, srcName), "utf8"))
  console.log(`  ✓ ${meta.name} → ${dest}`)

  // Copy commands/ directory if present
  const cmdSrc = join(meta.dir, "commands")
  if (existsSync(cmdSrc) && statSync(cmdSrc).isDirectory()) {
    const cmdDest = join(dataDir, "commands")
    mkdirSync(cmdDest, { recursive: true })
    for (const f of readdirSync(cmdSrc)) {
      if (f.endsWith(".md")) {
        writeFileSync(join(cmdDest, f), readFileSync(join(cmdSrc, f), "utf8"))
        console.log(`  ✓ command ${f} → ${cmdDest}/${f}`)
      }
    }
  }
}

function runInstall(dataDir, _configDir, label, pluginMap, requested) {
  const targetPluginsDir = join(dataDir, "plugins")
  const packageJson = join(dataDir, "package.json")
  console.log(`\n→ Installing ${label}…\n`)
  for (const name of requested) {
    const meta = pluginMap.get(name)
    if (!meta) { console.log(`  ✗ Unknown plugin: "${name}" — skipping`); continue }
    installPlugin(meta, targetPluginsDir, dataDir)
  }
  let pkg = existsSync(packageJson) ? JSON.parse(readFileSync(packageJson, "utf8")) : {}
  pkg.dependencies = pkg.dependencies || {}
  if (pkg.dependencies["@opencode-ai/plugin"]) {
    console.log("  ✓ @opencode-ai/plugin already in dependencies")
  } else {
    pkg.dependencies["@opencode-ai/plugin"] = "^1.0.0"
    console.log("  + @opencode-ai/plugin added")
  }
  writeFileSync(packageJson, JSON.stringify(pkg, null, 2) + "\n")
  console.log("  Installing dependencies…")
  execSync("npm install --no-audit --no-fund", { cwd: dataDir, stdio: "pipe" })
  console.log("  ✓ Dependencies installed")
  console.log(`\n  Done (${label})\n`)
}

// ── Interactive UI ────────────────────────────────────────────────────

function clearLines(n) {
  for (let i = 0; i < n; i++) {
    process.stdout.write("\x1b[1A\x1b[2K")
  }
}

function drawList(choices, cursor, selected, title) {
  let lines = 0
  if (title) { process.stdout.write(`\n  ${title}\n\n`); lines += 2 }
  for (let i = 0; i < choices.length; i++) {
    const prefix = i === cursor ? "❯" : " "
    let mark = ""
    if (selected) {
      mark = selected.has(i) ? "\x1b[32m●\x1b[0m" : "○"
    }
    const label = i === cursor ? `\x1b[1m${choices[i].label}\x1b[0m` : choices[i].label
    const hint = choices[i].hint ? ` \x1b[2m${choices[i].hint}\x1b[0m` : ""
    process.stdout.write(`   ${prefix} ${mark ? mark + " " : ""}${label}${hint}\n`)
    lines++
  }
  return lines
}

async function promptList(question, choices, opts) {
  const multi = opts?.multi ?? false
  let cursor = opts?.defaultIndex ?? 0
  const selected = new Set()

  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  emitKeypressEvents(process.stdin)

  const render = () => {
    const lines = drawList(choices, cursor, multi ? selected : undefined, question)
    return lines
  }

  let lines = 0
  const redraw = () => {
    if (lines > 0) clearLines(lines)
    lines = render()
  }

  return new Promise((resolve, _reject) => {
    const onKey = (_str, key) => {
      if (key.name === "up" || key.name === "k") {
        cursor = (cursor - 1 + choices.length) % choices.length
        redraw()
      } else if (key.name === "down" || key.name === "j") {
        cursor = (cursor + 1) % choices.length
        redraw()
      } else if (key.name === "space" && multi) {
        if (selected.has(cursor)) selected.delete(cursor)
        else selected.add(cursor)
        redraw()
      } else if (key.name === "return") {
        if (multi) {
          if (selected.size === 0) selected.add(cursor)
          if (lines > 0) clearLines(lines)
          process.stdin.setRawMode(false)
          process.stdin.removeListener("keypress", onKey)
          resolve([...selected].sort().map((i) => choices[i].value))
        } else {
          if (lines > 0) clearLines(lines)
          process.stdin.setRawMode(false)
          process.stdin.removeListener("keypress", onKey)
          resolve([choices[cursor].value])
        }
      } else if (key.name === "c" && key.ctrl) {
        if (lines > 0) clearLines(lines)
        process.stdin.setRawMode(false)
        process.stdin.removeListener("keypress", onKey)
        console.log("\n  Cancelled.")
        process.exit(0)
      }
    }
    process.stdin.on("keypress", onKey)
    lines = render()
  })
}

async function promptConfirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`\n  ${question} [Y/n] `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() !== "n")
    })
  })
}

// ── Vision provider setup ─────────────────────────────────────────────

const DEFAULT_VISION_MODELS = {
  openai: ["gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229"],
  openrouter: ["qwen/qwen3-vl-32b-instruct", "google/gemini-2.0-flash-exp:free", "openai/gpt-4o"],
  groq: ["llama-3.2-11b-vision-preview", "llama-3.2-90b-vision-preview"],
  deepseek: [],
  together: ["meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo"],
  fireworks: [],
  xai: [],
}

// Providers that have a key in auth.json AND a known vision model.
function eligibleVisionProviders() {
  const authPath = join(homedir(), ".local", "share", "opencode", "auth.json")
  if (!existsSync(authPath)) return []
  let auth = {}
  try { auth = JSON.parse(readFileSync(authPath, "utf8")) } catch { return [] }
  const out = []
  for (const [pid, info] of Object.entries(auth)) {
    if (info?.key && DEFAULT_VISION_MODELS[pid]?.length > 0) {
      out.push({ id: pid, models: DEFAULT_VISION_MODELS[pid] })
    }
  }
  return out
}

// Write the config the plugin actually reads: ad-vision.json with provider+model.
// The API key and baseUrl are derived by the plugin from the provider id, so they
// are intentionally NOT stored here.
function writeVisionConfig(configDir, provider, model) {
  const path = join(configDir, "ad-vision.json")
  let existing = {}
  if (existsSync(path)) {
    try { existing = JSON.parse(readFileSync(path, "utf8")) } catch { /* overwrite garbage */ }
  }
  mkdirSync(configDir, { recursive: true })
  writeFileSync(path, JSON.stringify({ ...existing, provider, model, enabled: true }, null, 2) + "\n")
  return path
}

// Interactive: ask provider + model, write ad-vision.json into configDir.
async function configureVision(configDir) {
  const available = eligibleVisionProviders()
  if (available.length === 0) {
    console.log("\n  Vision: no vision-capable provider key found in auth.json.")
    console.log("  Add an openrouter / openai / anthropic / groq / together key, then run /ad-vision.\n")
    return
  }

  console.log("")
  const want = await promptConfirm("Configure vision provider now? (keys detected: " + available.map((p) => p.id).join(", ") + ")")
  if (!want) {
    console.log("  Skipped — vision will auto-discover a provider, or run /ad-vision later.\n")
    return
  }

  const [pid] = await promptList("Select vision provider:", available.map((p) => ({ label: p.id, value: p.id })))
  const provider = available.find((p) => p.id === pid)
  if (!provider) return

  const modelChoices = provider.models.map((m) => ({ label: m, value: m }))
  modelChoices.push({ label: "Custom (type manually)", value: "__custom__" })
  const [model] = await promptList("Select vision model:", modelChoices)

  let finalModel = model
  if (model === "__custom__") {
    finalModel = await promptText("Enter model ID:")
    if (!finalModel) return
  }

  const path = writeVisionConfig(configDir, pid, finalModel)
  console.log(`\n  ✓ Vision configured → ${path}`)
  console.log(`    { provider: "${pid}", model: "${finalModel}" }  — change anytime with /ad-vision\n`)
}

// Non-interactive: write a config when the choice is unambiguous, else hint.
function postInstallVisionHint(configDir) {
  const path = join(configDir, "ad-vision.json")
  if (existsSync(path)) {
    console.log(`\n  Vision: config already present → ${path}`)
    return
  }
  const available = eligibleVisionProviders()
  if (available.length === 0) {
    console.log("\n  Vision: no vision-capable provider key in auth.json yet.")
    console.log("  Add an openrouter / openai / anthropic / groq / together key, then run /ad-vision.")
    return
  }
  if (available.length === 1) {
    const p = available[0]
    const written = writeVisionConfig(configDir, p.id, p.models[0])
    console.log(`\n  ✓ Vision auto-configured → ${written}`)
    console.log(`    { provider: "${p.id}", model: "${p.models[0]}" }  — change with /ad-vision`)
    return
  }
  console.log("\n  Vision: multiple provider keys detected (" + available.map((p) => p.id).join(", ") + ").")
  console.log("  Run /ad-vision to pick provider + model (auto-discovery will otherwise choose one).")
}

async function promptText(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`  ${question} `, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const pluginMap = discoverPlugins()
  const args = process.argv.slice(2)

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`\nopencode-plugins v${PKG.version} — install OpenCode plugins from this collection.\n\nUsage: npx github:aadegtyarev/opencode-plugins [flags] [plugin...]\n`)
    console.log("Flags:\n  --local   Install into project .opencode/\n  --global  Install into ~/.config/opencode/\n  --help    Show this help\n")
    console.log("Available plugins:")
    for (const [name] of pluginMap) console.log(`  ${name}`)
    console.log("\nPlugins are copied to <target>/plugins/ and auto-loaded — no config changes needed.")
    console.log("Target is .opencode/ (local) or ~/.config/opencode/ (global, with --global).")
    console.log("When ad-vision is installed, a vision provider+model is configured into")
    console.log("<target>/ad-vision.json (auto when one key is found; otherwise run /ad-vision).")
    console.log("\nRun without arguments for interactive mode.\n")
    process.exit(0)
  }

  if (pluginMap.size === 0) {
    console.log("No plugins found in the package.")
    process.exit(1)
  }

  const flags = args.filter((a) => a.startsWith("--"))
  const names = args.filter((a) => !a.startsWith("--"))

  // ── Non-interactive mode (arguments provided) ──────────────────────
  if (names.length > 0 || flags.includes("--local") || flags.includes("--global")) {
    const requested = names.length > 0 ? names : [...pluginMap.keys()]
    const cwd = process.cwd()
    // --global → ~/.config/opencode; otherwise local .opencode/ of the cwd.
    const configDir = flags.includes("--global") ? GLOBAL_DIR : join(cwd, ".opencode")
    const label = flags.includes("--global") ? "global (~/.config/opencode/)" : "local (.opencode/)"
    runInstall(configDir, configDir, label, pluginMap, requested)
    if (requested.includes("ad-vision")) postInstallVisionHint(configDir)
    return
  }

  // ── Interactive mode (no arguments) ────────────────────────────────
  console.log(`\n  opencode-plugins installer  v${PKG.version}\n`)

  // Step 1: choose target
  const cwd = process.cwd()
  const hasLocal = existsSync(join(cwd, ".opencode")) || findConfig(cwd) !== null
  const defaultTarget = hasLocal ? 0 : 1
  const localLabel = `Local  (.opencode/ of ${cwd.split("/").pop() || cwd})`
  const globalLabel = `Global (~/.config/opencode/)`
  const [target] = await promptList("Where to install?", [
    { label: localLabel, value: "local" },
    { label: globalLabel, value: "global" },
  ], { defaultIndex: defaultTarget })

  // Step 2: choose plugins
  const pluginChoices = [...pluginMap.entries()].map(([name]) => ({
    label: name,
    value: name,
  }))
  const selectedPlugins = await promptList("Select plugins (Space to toggle, Enter to confirm):", pluginChoices, { multi: true })

  // Step 3: summary + confirm
  const configDir = target === "local" ? join(cwd, ".opencode") : GLOBAL_DIR
  const label = target === "local" ? "local (.opencode/)" : "global (~/.config/opencode/)"
  console.log(`\n  Target:  ${label}`)
  console.log(`  Plugins: ${selectedPlugins.join(", ")}`)
  console.log(`\n  Files are auto-loaded — no config changes needed.`)
  const ok = await promptConfirm("Proceed with installation?")
  if (!ok) { console.log("  Cancelled.\n"); process.exit(0) }

  runInstall(configDir, configDir, label, pluginMap, selectedPlugins)

  // Step 4: configure vision provider (writes ad-vision.json into the same dir)
  if (selectedPlugins.includes("ad-vision")) await configureVision(configDir)
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})

#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
import { homedir } from "node:os"
import { createInterface, emitKeypressEvents } from "node:readline"

const __dirname = dirname(fileURLToPath(import.meta.url))
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

function installPlugin(meta, targetPluginsDir) {
  const targetPluginsDir = join(dataDir, "plugins")
  const packageJson = join(dataDir, "package.json")
  console.log(`\n→ Installing ${label}…\n`)
  for (const name of requested) {
    const meta = pluginMap.get(name)
    if (!meta) { console.log(`  ✗ Unknown plugin: "${name}" — skipping`); continue }
    installPlugin(meta, targetPluginsDir)
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

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const pluginMap = discoverPlugins()
  const args = process.argv.slice(2)

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`\nopencode-plugins — install OpenCode plugins from this collection.\n\nUsage: npx github:aadegtyarev/opencode-plugins [flags] [plugin...]\n`)
    console.log("Flags:\n  --local   Install into project .opencode/\n  --global  Install into ~/.config/opencode/\n  --help    Show this help\n")
    console.log("Available plugins:")
    for (const [name] of pluginMap) console.log(`  ${name}`)
    console.log("\nPlugins are copied to .opencode/plugins/ and auto-loaded — no config changes needed.")
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
    const hasLocal = existsSync(join(cwd, ".opencode")) || findConfig(cwd) !== null
    if (flags.includes("--global")) {
      runInstall(GLOBAL_DIR, GLOBAL_DIR, "global (~/.config/opencode/)", pluginMap, requested)
    } else if (flags.includes("--local")) {
      runInstall(join(cwd, ".opencode"), cwd, "local (.opencode/)", pluginMap, requested)
    } else if (hasLocal) {
      runInstall(join(cwd, ".opencode"), cwd, "local (.opencode/)", pluginMap, requested)
    } else {
      runInstall(GLOBAL_DIR, GLOBAL_DIR, "global (~/.config/opencode/)", pluginMap, requested)
    }
    return
  }

  // ── Interactive mode (no arguments) ────────────────────────────────
  console.log("\n  opencode-plugins installer\n")

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
  const label = target === "local" ? "local (.opencode/)" : "global (~/.config/opencode/)"
  console.log(`\n  Target:  ${label}`)
  console.log(`  Plugins: ${selectedPlugins.join(", ")}`)
  console.log(`\n  Files are auto-loaded — no config changes needed.`)
  const ok = await promptConfirm("Proceed with installation?")
  if (!ok) { console.log("  Cancelled.\n"); process.exit(0) }

  if (target === "local") {
    runInstall(join(cwd, ".opencode"), cwd, label, pluginMap, selectedPlugins)
  } else {
    runInstall(GLOBAL_DIR, GLOBAL_DIR, label, pluginMap, selectedPlugins)
  }
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})

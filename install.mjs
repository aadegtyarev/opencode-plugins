#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
import { homedir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const GLOBAL_DIR = join(homedir(), ".config", "opencode")
const PLUGINS_SRC = join(__dirname, "plugins")

// ── Helpers ───────────────────────────────────────────────────────────

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
}

function readJsonc(path: string): { json: any; raw: string } | null {
  if (!existsSync(path)) return null
  const raw = readFileSync(path, "utf8")
  try { return { json: JSON.parse(stripJsonComments(raw)), raw } } catch { return null }
}

function findConfig(dir: string): string | null {
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return null
}

// ── Plugin discovery ──────────────────────────────────────────────────

interface PluginMeta {
  name: string
  dir: string
  files: string[] // relative paths from plugins/<name>/
}

function discoverPlugins(): Map<string, PluginMeta> {
  const plugins = new Map<string, PluginMeta>()

  if (!existsSync(PLUGINS_SRC)) return plugins

  for (const entry of readdirSync(PLUGINS_SRC)) {
    const full = join(PLUGINS_SRC, entry)
    if (!statSync(full).isDirectory()) continue

    const files: string[] = []
    for (const f of readdirSync(full)) {
      if (f.endsWith(".ts") || f.endsWith(".js")) {
        files.push(f)
      }
    }
    if (files.length === 0) continue

    plugins.set(entry, { name: entry, dir: full, files })
  }
  return plugins
}

// ── Install one plugin ────────────────────────────────────────────────

function installPlugin(meta: PluginMeta, targetPluginsDir: string): boolean {
  const dest = join(targetPluginsDir, `${meta.name}.ts`)

  // Use index.ts if present, otherwise first .ts file
  const srcName = meta.files.includes("index.ts") ? "index.ts" : meta.files[0]
  const src = join(meta.dir, srcName)

  mkdirSync(targetPluginsDir, { recursive: true })
  writeFileSync(dest, readFileSync(src, "utf8"))
  console.log(`  ✓ ${meta.name} → ${dest}`)
  return true
}

function addPluginToConfig(configPath: string, name: string): boolean {
  const existing = readJsonc(configPath)
  let config = existing?.json || {}
  if (!Array.isArray(config.plugin)) config.plugin = []

  const hasPlugin = config.plugin.some((p: any) =>
    (typeof p === "string" && p === name) ||
    (Array.isArray(p) && p[0] === name)
  )
  if (hasPlugin) {
    console.log(`  ✓ "${name}" already in config`)
    return false
  }

  config.plugin.push(name)
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
  console.log(`  ✓ Added "${name}" to ${configPath}`)
  return true
}

// ── Main install ──────────────────────────────────────────────────────

function install(
  dataDir: string,
  configDir: string,
  label: string,
  plugins: Map<string, PluginMeta>,
  requested: string[],
) {
  const targetPluginsDir = join(dataDir, "plugins")
  const packageJson = join(dataDir, "package.json")

  console.log(`→ Installing ${label}…\n`)

  // Copy plugins
  for (const name of requested) {
    const meta = plugins.get(name)
    if (!meta) {
      console.log(`  ✗ Unknown plugin: "${name}" — skipping`)
      continue
    }
    installPlugin(meta, targetPluginsDir)
  }

  // Ensure dependencies
  let pkg: any = {}
  if (existsSync(packageJson)) {
    pkg = JSON.parse(readFileSync(packageJson, "utf8"))
  }
  pkg.dependencies = pkg.dependencies || {}
  if (pkg.dependencies["@opencode-ai/plugin"]) {
    console.log("  ✓ @opencode-ai/plugin already in dependencies")
  } else {
    pkg.dependencies["@opencode-ai/plugin"] = "^1.0.0"
    console.log("  + @opencode-ai/plugin added")
  }
  writeFileSync(packageJson, JSON.stringify(pkg, null, 2) + "\n")

  // npm install
  console.log("  Installing dependencies…")
  execSync("npm install --no-audit --no-fund", { cwd: dataDir, stdio: "pipe" })
  console.log("  ✓ Dependencies installed")

  // Register plugins in config
  const configPath = findConfig(configDir)
  if (configPath) {
    for (const name of requested) {
      if (plugins.has(name)) {
        addPluginToConfig(configPath, name)
      }
    }
  } else {
    const newPath = join(configDir, "opencode.json")
    const names = requested.filter((n) => plugins.has(n))
    writeFileSync(newPath, JSON.stringify({ plugin: names }, null, 2) + "\n")
    console.log(`  ✓ Created ${newPath} with: ${names.join(", ")}`)
  }

  console.log(`\n  Done (${label})\n`)
}

// ── CLI ───────────────────────────────────────────────────────────────

const plugins = discoverPlugins()

function showHelp() {
  console.log(`
opencode-plugins — install OpenCode plugins from this collection.

Usage: npx opencode-plugins [flags] [plugin...]

Flags:
  --local   Install into project .opencode/
  --global  Install into ~/.config/opencode/
  --help    Show this help

Available plugins:`)

  for (const [name] of plugins) {
    console.log(`  ${name}`)
  }
  console.log(`
Examples:
  npx opencode-plugins vision
  npx opencode-plugins vision foo --local
  npx opencode-plugins --global           # installs ALL
`)
}

const args = process.argv.slice(2)

if (args.includes("--help") || args.includes("-h")) {
  showHelp()
  process.exit(0)
}

const flags = args.filter((a) => a.startsWith("--"))
const names = args.filter((a) => !a.startsWith("--"))
const requested = names.length > 0 ? names : [...plugins.keys()]

if (requested.length === 0) {
  console.log("No plugins found in the package.")
  process.exit(1)
}

const cwd = process.cwd()
const hasLocal = existsSync(join(cwd, ".opencode")) || findConfig(cwd) !== null

if (flags.includes("--global")) {
  install(GLOBAL_DIR, GLOBAL_DIR, "global (~/.config/opencode/)", plugins, requested)
} else if (flags.includes("--local")) {
  install(join(cwd, ".opencode"), cwd, "local (.opencode/)", plugins, requested)
} else if (hasLocal) {
  install(join(cwd, ".opencode"), cwd, "local (.opencode/)", plugins, requested)
} else {
  install(GLOBAL_DIR, GLOBAL_DIR, "global (~/.config/opencode/)", plugins, requested)
}

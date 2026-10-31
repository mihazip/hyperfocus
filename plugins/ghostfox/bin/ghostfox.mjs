#!/usr/bin/env node
// ghostfox: a headless Firefox for Claude that is logged in wherever your everyday Firefox is.
// Wraps @mozilla/firefox-devtools-mcp. At the first tool call (when Firefox launches) it claims a
// free agent profile and copies cookies and localStorage from your main profile into it. Your main
// profile is only ever read.
//
//   node ghostfox.mjs [extra firefox-devtools-mcp args]   run as an MCP server (stdio)
//   node ghostfox.mjs sync                                 one sync into a free slot, for testing

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { delimiter, isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'

const MCP_PACKAGE = '@mozilla/firefox-devtools-mcp'
const MCP_VERSION = '0.10.7'
const MAX_SLOTS = 8
const WIN = process.platform === 'win32'
const HOME = process.env.GHOSTFOX_HOME || join(homedir(), '.ghostfox')
const SITES = (process.env.GHOSTFOX_SITES || '')
  .split(',')
  .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
  .filter(Boolean)

// node:sqlite still prints an ExperimentalWarning; keep stderr readable
process.removeAllListeners('warning')
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') log(`${w.name}: ${w.message}`)
})

function log(msg) {
  process.stderr.write(`[ghostfox] ${msg}\n`)
}

// ---------- main profile ----------

function firefoxRoot() {
  if (WIN) return join(process.env.APPDATA, 'Mozilla', 'Firefox')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Firefox')
  return join(homedir(), '.mozilla', 'firefox')
}

function parseIni(text) {
  const sections = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const head = line.match(/^\[(.+)\]$/)
    if (head) sections.push({ name: head[1] })
    else if (sections.length && line.includes('=')) {
      const i = line.indexOf('=')
      sections.at(-1)[line.slice(0, i)] = line.slice(i + 1)
    }
  }
  return sections
}

// The profile your Firefox opens: the [Install…] default, else the profile marked Default=1
function sourceProfile() {
  if (process.env.GHOSTFOX_SOURCE_PROFILE) return process.env.GHOSTFOX_SOURCE_PROFILE
  const root = firefoxRoot()
  const ini = join(root, 'profiles.ini')
  if (!existsSync(ini)) return null
  const sections = parseIni(readFileSync(ini, 'utf8'))
  const install = sections.find((s) => s.name.startsWith('Install') && s.Default)
  if (install) return isAbsolute(install.Default) ? install.Default : join(root, install.Default)
  const profiles = sections.filter((s) => s.name.startsWith('Profile') && s.Path)
  const p = profiles.find((s) => s.Default === '1') ?? profiles[0]
  if (!p) return null
  return p.IsRelative === '0' ? p.Path : join(root, p.Path)
}

// ---------- agent profile slots ----------

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

// One slot per running ghostfox, so parallel Claude sessions each get their own Firefox
function claimSlot() {
  for (let i = 0; i < MAX_SLOTS; i++) {
    const dir = join(HOME, 'profiles', String(i))
    mkdirSync(dir, { recursive: true })
    const pidFile = join(dir, 'ghostfox.pid')
    if (existsSync(pidFile)) {
      const owner = Number(readFileSync(pidFile, 'utf8'))
      if (owner && alive(owner)) continue
      rmSync(pidFile, { force: true })
    }
    try {
      writeFileSync(pidFile, String(process.pid), { flag: 'wx' })
    } catch {
      continue
    }
    prepareSlot(dir)
    return dir
  }
  throw new Error(`all ${MAX_SLOTS} ghostfox profiles in ${HOME} are in use`)
}

function releaseSlot(dir) {
  try {
    if (Number(readFileSync(join(dir, 'ghostfox.pid'), 'utf8')) === process.pid) unlinkSync(join(dir, 'ghostfox.pid'))
  } catch {}
}

const USER_JS = `// written by ghostfox
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.page", 0);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("signon.rememberSignons", false);
`

function prepareSlot(dir) {
  // marks the folder as an MCP profile, so firefox-devtools-mcp uses it as is
  writeFileSync(join(dir, '.firefox-devtools-mcp'), '')
  writeFileSync(join(dir, 'user.js'), USER_JS)
}

// ---------- sync ----------

function matchesSite(host) {
  host = host.replace(/^\./, '').toLowerCase()
  return !SITES.length || SITES.some((s) => host === s || host.endsWith(`.${s}`))
}

// Firefox holds its databases with an exclusive lock, so work on a copy; the -wal has the newest writes
function snapshot(dir, name, tmp) {
  for (const ext of ['', '-wal']) {
    const f = join(dir, name + ext)
    if (existsSync(f)) copyFileSync(f, join(tmp, name + ext))
  }
  return join(tmp, name)
}

async function syncCookies(src, dest, tmp) {
  if (!existsSync(join(src, 'cookies.sqlite'))) return 0
  const { DatabaseSync } = await import('node:sqlite')
  const copy = snapshot(src, 'cookies.sqlite', tmp)
  const target = join(dest, 'cookies.sqlite')
  if (!existsSync(target)) {
    // first run: start from the main profile's file, so the schema is the one this Firefox writes
    const db = new DatabaseSync(copy)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    copyFileSync(copy, target)
    const fresh = new DatabaseSync(target)
    fresh.exec('DELETE FROM moz_cookies')
    fresh.close()
  }
  const db = new DatabaseSync(target)
  try {
    db.prepare('ATTACH DATABASE ? AS ff').run(copy)
    const names = (schema) => db.prepare(`PRAGMA ${schema}.table_info(moz_cookies)`).all().map((c) => c.name)
    const theirs = new Set(names('ff'))
    const cols = names('main').filter((c) => c !== 'id' && theirs.has(c)).join(', ')
    const rows = db.prepare(`SELECT ${cols} FROM ff.moz_cookies`).all().filter((r) => matchesSite(r.host))
    const insert = db.prepare(`INSERT OR REPLACE INTO moz_cookies (${cols}) VALUES (${cols.replace(/\w+/g, '?')})`)
    const keys = cols.split(', ')
    db.exec('BEGIN')
    for (const r of rows) insert.run(...keys.map((k) => r[k]))
    db.exec('COMMIT')
    return rows.length
  } finally {
    db.close()
  }
}

// storage/default/https+++www.example.com+8080^userContextId=1 -> www.example.com
function originHost(dirName) {
  return dirName.replace(/^https?\+\+\+/, '').split(/[+^]/)[0]
}

function stamp(dir) {
  return readdirSync(dir)
    .sort()
    .map((f) => {
      const s = statSync(join(dir, f))
      return `${f}:${s.size}:${Math.round(s.mtimeMs)}`
    })
    .join('|')
}

async function syncLocalStorage(src, dest) {
  const from = join(src, 'storage', 'default')
  const to = join(dest, 'storage', 'default')
  if (!existsSync(from)) return 0
  const manifestFile = join(dest, 'ghostfox-ls.json')
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {}
  let copied = 0
  for (const origin of readdirSync(from)) {
    // web origins only: extension storage and chrome:// belong to the main profile's add-ons
    if (!/^https?\+\+\+/.test(origin) || !matchesSite(originHost(origin))) continue
    const ls = join(from, origin, 'ls')
    if (!existsSync(join(ls, 'data.sqlite'))) continue
    let current
    try {
      current = stamp(ls)
    } catch {
      continue
    }
    if (manifest[origin] === current && existsSync(join(to, origin, 'ls'))) continue
    try {
      // replace the whole ls folder: a stale -wal next to a new data.sqlite would corrupt it
      rmSync(join(to, origin, 'ls'), { recursive: true, force: true })
      mkdirSync(join(to, origin, 'ls'), { recursive: true })
      for (const f of readdirSync(ls)) if (!f.endsWith('-shm')) copyFileSync(join(ls, f), join(to, origin, 'ls', f))
      const meta = join(from, origin, '.metadata-v2')
      if (existsSync(meta)) copyFileSync(meta, join(to, origin, '.metadata-v2'))
      manifest[origin] = current
      copied++
    } catch (e) {
      log(`skipped localStorage of ${origin}: ${e.message}`)
    }
  }
  writeFileSync(manifestFile, JSON.stringify(manifest))
  if (copied && existsSync(join(dest, 'storage.sqlite'))) {
    // make Firefox's quota manager rescan storage/ instead of trusting its cached origin list
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(join(dest, 'storage.sqlite'))
    try {
      db.exec('UPDATE cache SET valid = 0')
    } catch (e) {
      log(`could not invalidate the storage cache: ${e.message}`)
    } finally {
      db.close()
    }
  }
  return copied
}

async function sync(dest) {
  const src = sourceProfile()
  if (!src || !existsSync(src)) {
    log('no Firefox profile found to copy from (set GHOSTFOX_SOURCE_PROFILE); starting logged out')
    return
  }
  const started = Date.now()
  const tmp = mkdtempSync(join(tmpdir(), 'ghostfox-'))
  try {
    const cookies = await syncCookies(src, dest, tmp)
    const ls = await syncLocalStorage(src, dest)
    const scope = SITES.length ? ` for ${SITES.join(', ')}` : ''
    log(`synced ${cookies} cookies and ${ls} localStorage origins${scope} from ${src} in ${Date.now() - started} ms`)
  } catch (e) {
    log(`sync failed, using the logins already in the agent profile: ${e.message}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------- firefox-devtools-mcp ----------

function has(cmd) {
  return spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: WIN }).status === 0
}

// Installed once into ~/.ghostfox/runtime, so starts don't resolve packages or write to stdout
function mcpEntry() {
  const runtime = join(HOME, 'runtime')
  const pkgDir = join(runtime, 'node_modules', ...MCP_PACKAGE.split('/'))
  const installed = existsSync(join(pkgDir, 'package.json')) && JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version
  if (installed !== MCP_VERSION) {
    log(`installing ${MCP_PACKAGE}@${MCP_VERSION} into ${runtime}`)
    mkdirSync(runtime, { recursive: true })
    if (!existsSync(join(runtime, 'package.json'))) writeFileSync(join(runtime, 'package.json'), '{ "private": true }\n')
    // no install scripts: geckodriver's postinstall is blocked by pnpm, and the MCP downloads it on first launch
    const spec = `${MCP_PACKAGE}@${MCP_VERSION}`
    const [cmd, args] = has('pnpm') ? ['pnpm', ['add', '--ignore-scripts', spec]] : ['npm', ['install', '--ignore-scripts', spec]]
    const r = spawnSync(cmd, args, { cwd: runtime, stdio: ['ignore', 2, 2], shell: WIN })
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${runtime}`)
  }
  ensureGeckodriver(pkgDir)
  return join(pkgDir, JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).bin['firefox-devtools-mcp'])
}

// The MCP fetches geckodriver itself when it is missing, but that download logs to stdout and
// breaks the MCP stream. Fetch it here once, logging to stderr, and put it on the child's PATH.
function ensureGeckodriver(pkgDir) {
  const binDir = join(HOME, 'bin')
  if (existsSync(join(binDir, WIN ? 'geckodriver.exe' : 'geckodriver'))) return
  log(`downloading geckodriver into ${binDir}`)
  const install = createRequire(join(realpathSync(pkgDir), 'package.json')).resolve('geckodriver')
  const script = `const { download } = require(${JSON.stringify(install)}); download(undefined, ${JSON.stringify(binDir)}).catch((e) => { console.error(e); process.exit(1) })`
  const r = spawnSync(process.execPath, ['-e', script], { stdio: ['ignore', 2, 2] })
  if (r.status !== 0) throw new Error('geckodriver download failed')
}

function mcpArgs(slot) {
  const args = ['--viewport', '1280x900', '--pref', 'remote.prefs.recommended=false']
  if (slot) args.unshift('--profile-path', slot)
  if (process.env.GHOSTFOX_HEADLESS !== '0') args.unshift('--headless')
  if (process.env.GHOSTFOX_FIREFOX) args.push('--firefox-path', process.env.GHOSTFOX_FIREFOX)
  return [...args, ...process.argv.slice(2)]
}

function parse(line) {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

// Starts firefox-devtools-mcp and relays its stdout, except replies to requests ghostfox sent itself
function startMcp(entry, slot) {
  const env = { ...process.env, PATH: `${join(HOME, 'bin')}${delimiter}${process.env.PATH}` }
  const child = spawn(process.execPath, [entry, ...mcpArgs(slot)], { stdio: ['pipe', 'pipe', 'inherit'], env })
  const own = new Map()
  createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on('line', (line) => {
    const msg = parse(line)
    const waiter = typeof msg?.id === 'string' && own.get(msg.id)
    if (!waiter) return process.stdout.write(`${line}\n`)
    own.delete(msg.id)
    waiter(msg)
  })
  const send = (msg) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
  const request = (id, method, params) =>
    new Promise((resolve) => {
      own.set(id, resolve)
      send({ id, method, params })
    })
  return { child, send, request }
}

async function serve() {
  const entry = mcpEntry()
  // Most sessions never browse. The MCP answers initialize and tools/list without a profile, so a
  // slot is claimed only at the first tool call, and the MCP is restarted on it then.
  let mcp
  let slot = null
  let initParams
  let synced = false
  const use = (next) => {
    mcp = next
    // 'close' waits for stdout to drain; a replaced MCP's exit is ignored
    next.child.on('close', (code) => {
      if (mcp !== next) return
      if (slot) releaseSlot(slot)
      process.exit(code ?? 0)
    })
  }
  use(startMcp(entry, null))
  const stop = () => mcp.child.kill()
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  const attach = async () => {
    slot = claimSlot()
    log(`agent profile ${slot}`)
    const old = mcp
    use(startMcp(entry, slot))
    old.child.stdin.end()
    // the new MCP starts while the logins are copied; Firefox itself launches at the forwarded call
    const [init] = await Promise.all([mcp.request('ghostfox-init', 'initialize', initParams), sync(slot)])
    if (init.error) log(`MCP restart: initialize failed: ${init.error.message}`)
    mcp.send({ method: 'notifications/initialized' })
  }

  // Relay stdin line by line; the first tool call launches Firefox, so sync just before it
  let queue = Promise.resolve()
  const forward = async (line) => {
    const msg = parse(line)
    if (msg?.method === 'initialize') initParams = msg.params
    if (msg?.method === 'tools/call') {
      if (!slot) {
        try {
          await attach()
        } catch (e) {
          slot = null
          const result = { content: [{ type: 'text', text: `ghostfox: ${e.message}` }], isError: true }
          process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n`)
          return
        }
        synced = true
      } else if (!synced) {
        synced = true
        await sync(slot)
      }
    }
    mcp.child.stdin.write(`${line}\n`)
    // after Firefox is closed, the next call relaunches it: pick up fresh logins then
    if (msg?.method === 'tools/call' && msg.params?.name === 'close_firefox_session') synced = false
  }
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })
  rl.on('line', (line) => {
    queue = queue.then(() => forward(line))
  })
  rl.on('close', () => {
    queue.then(() => mcp.child.stdin.end())
  })
}

if (process.argv[2] === 'sync') {
  const slot = claimSlot()
  await sync(slot)
  releaseSlot(slot)
  log(`done: ${slot}`)
} else {
  await serve()
}

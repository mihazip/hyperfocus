// Run with: node --test plugins/ghostfox/tests/sync.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ghostfox.mjs')
const scratch = mkdtempSync(join(tmpdir(), 'ghostfox-test-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

// the test process is alive, so it stands in for the Claude Code process that owns the grant
const OWNER = String(process.pid)

let count = 0

function cookieDb(file, hosts) {
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE IF NOT EXISTS moz_cookies (id INTEGER PRIMARY KEY, name TEXT, value TEXT, host TEXT, path TEXT, UNIQUE (name, host, path))')
  const insert = db.prepare("INSERT OR REPLACE INTO moz_cookies (name, value, host, path) VALUES ('session', 'x', ?, '/')")
  for (const host of hosts) insert.run(host)
  db.close()
}

function fixture() {
  const dir = join(scratch, String(count++))
  const source = join(dir, 'source')
  const home = join(dir, 'home')
  mkdirSync(source, { recursive: true })
  mkdirSync(home, { recursive: true })
  cookieDb(join(source, 'cookies.sqlite'), ['.github.com', 'api.github.com', 'notgithub.com', '.bank.example'])
  for (const origin of ['https+++github.com', 'https+++bank.example']) {
    const ls = join(source, 'storage', 'default', origin, 'ls')
    mkdirSync(ls, { recursive: true })
    writeFileSync(join(ls, 'data.sqlite'), 'x')
  }
  return { source, home, slot: join(home, 'profiles', '0') }
}

function run({ source, home }, args, env = {}) {
  const { GHOSTFOX_SITES: _, CLAUDE_PID: __, ...base } = process.env
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...base, GHOSTFOX_HOME: home, GHOSTFOX_SOURCE_PROFILE: source, GHOSTFOX_OWNER_PID: OWNER, ...env },
  })
}

const sync = (f, env) => run(f, ['sync'], env)
const grant = (f, ...sites) => run(f, ['grant', ...sites])

function cookieHosts(slot) {
  if (!existsSync(join(slot, 'cookies.sqlite'))) return []
  const db = new DatabaseSync(join(slot, 'cookies.sqlite'))
  const hosts = db.prepare('SELECT host FROM moz_cookies ORDER BY host').all().map((r) => r.host)
  db.close()
  return hosts
}

function origins(slot) {
  const root = join(slot, 'storage', 'default')
  return existsSync(root) ? readdirSync(root).sort() : []
}

test('without a grant, no login is copied', () => {
  const f = fixture()
  assert.equal(sync(f).status, 0)
  assert.deepEqual(cookieHosts(f.slot), [])
  assert.deepEqual(origins(f.slot), [])
})

test('a grant copies a domain and its subdomains', () => {
  const f = fixture()
  const g = grant(f, 'https://www.GitHub.com/mihazip')
  assert.equal(g.status, 0)
  assert.match(g.stdout, /can use your Firefox logins for github\.com/)
  assert.equal(sync(f).status, 0)
  assert.deepEqual(cookieHosts(f.slot), ['.github.com', 'api.github.com'])
  assert.deepEqual(origins(f.slot), ['https+++github.com'])
})

test('a grant lists several sites in plain words', () => {
  const f = fixture()
  const g = grant(f, 'github.com,', 'bank.example', 'dash.cloudflare.com')
  assert.match(g.stdout, /for github\.com, bank\.example and dash\.cloudflare\.com \(with subdomains\)/)
  assert.match(g.stdout, /ends when this Claude Code session ends/)
})

test('a grant without sites shows the current grant and changes nothing', () => {
  const f = fixture()
  grant(f, 'github.com')
  const g = grant(f)
  assert.match(g.stdout, /logins for github\.com/)
  assert.doesNotMatch(g.stdout, /restarts/)
})

test('a narrower grant removes logins from an earlier sync', () => {
  const f = fixture()
  grant(f, 'github.com', 'bank.example')
  assert.equal(sync(f).status, 0)
  grant(f, 'github.com')
  assert.equal(sync(f).status, 0)
  assert.deepEqual(cookieHosts(f.slot), ['.github.com', 'api.github.com'])
  assert.deepEqual(origins(f.slot), ['https+++github.com'])
})

test('a grant removes logins that the agent made itself', () => {
  const f = fixture()
  assert.equal(sync(f).status, 0)
  cookieDb(join(f.slot, 'cookies.sqlite'), ['agent.example'])
  grant(f, 'github.com')
  assert.equal(sync(f).status, 0)
  assert.ok(!cookieHosts(f.slot).includes('agent.example'))
})

test('off removes the grant and the logins', () => {
  const f = fixture()
  grant(f, 'github.com')
  assert.equal(sync(f).status, 0)
  const g = grant(f, 'off')
  assert.match(g.stdout, /has no Firefox logins/)
  assert.ok(!existsSync(join(f.home, 'grants', `${OWNER}.txt`)))
  assert.equal(sync(f).status, 0)
  assert.deepEqual(cookieHosts(f.slot), [])
  assert.deepEqual(origins(f.slot), [])
})

test('a grant that is not a domain changes nothing', () => {
  const f = fixture()
  grant(f, 'github.com')
  const g = grant(f, 'bank.example', 'com')
  assert.equal(g.status, 1)
  assert.match(g.stdout, /not a domain: com/)
  assert.equal(readFileSync(join(f.home, 'grants', `${OWNER}.txt`), 'utf8'), 'github.com\n')
})

test('a grant needs a Claude Code process', () => {
  const f = fixture()
  const g = run(f, ['grant', 'github.com'], { GHOSTFOX_OWNER_PID: '' })
  assert.equal(g.status, 1)
  assert.match(g.stdout, /no Claude Code session found/)
})

test('a grant belongs to one session only', () => {
  const f = fixture()
  run(f, ['grant', 'bank.example'], { GHOSTFOX_OWNER_PID: '', CLAUDE_PID: OWNER })
  assert.equal(sync(f, { GHOSTFOX_OWNER_PID: String(process.ppid) }).status, 0)
  assert.deepEqual(cookieHosts(f.slot), [])
})

test('the grant of a dead process is removed', () => {
  const f = fixture()
  mkdirSync(join(f.home, 'grants'), { recursive: true })
  // no running process has a pid this large
  writeFileSync(join(f.home, 'grants', '2147483646.txt'), 'bank.example\n')
  grant(f, 'github.com')
  assert.deepEqual(readdirSync(join(f.home, 'grants')), [`${OWNER}.txt`])
})

test('GHOSTFOX_SITES gives logins without a grant, and a grant replaces it', () => {
  const f = fixture()
  assert.equal(sync(f, { GHOSTFOX_SITES: 'bank.example' }).status, 0)
  assert.deepEqual(cookieHosts(f.slot), ['.bank.example'])
  grant(f, 'github.com')
  assert.equal(sync(f, { GHOSTFOX_SITES: 'bank.example' }).status, 0)
  assert.deepEqual(cookieHosts(f.slot), ['.github.com', 'api.github.com'])
})

test('the grant applies when the main profile is missing', () => {
  const f = fixture()
  grant(f, 'github.com', 'bank.example')
  assert.equal(sync(f).status, 0)
  grant(f, 'github.com')
  assert.equal(sync({ ...f, source: join(f.home, 'gone') }).status, 0)
  assert.deepEqual(cookieHosts(f.slot), ['.github.com', 'api.github.com'])
})

test('sync fails if a locked profile blocks the grant', () => {
  const f = fixture()
  grant(f, 'github.com', 'bank.example')
  assert.equal(sync(f).status, 0)
  grant(f, 'github.com')
  const lock = new DatabaseSync(join(f.slot, 'cookies.sqlite'))
  lock.exec('BEGIN EXCLUSIVE')
  const result = sync(f)
  lock.exec('ROLLBACK')
  lock.close()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /could not apply the login grant/)
})

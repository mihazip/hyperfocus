// Run with: node --test plugins/ghostfox/tests/sync.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ghostfox.mjs')
const scratch = mkdtempSync(join(tmpdir(), 'ghostfox-test-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

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

function sync({ source, home }, env = {}) {
  const { GHOSTFOX_SITES: _, ...base } = process.env
  return spawnSync(process.execPath, [BIN, 'sync'], {
    encoding: 'utf8',
    env: { ...base, GHOSTFOX_HOME: home, GHOSTFOX_SOURCE_PROFILE: source, ...env },
  })
}

function cookieHosts(slot) {
  const db = new DatabaseSync(join(slot, 'cookies.sqlite'))
  const hosts = db.prepare('SELECT host FROM moz_cookies ORDER BY host').all().map((r) => r.host)
  db.close()
  return hosts
}

function origins(slot) {
  const root = join(slot, 'storage', 'default')
  return existsSync(root) ? readdirSync(root).sort() : []
}

test('without a limit, every site is copied', () => {
  const f = fixture()
  assert.equal(sync(f).status, 0)
  assert.equal(cookieHosts(f.slot).length, 4)
  assert.deepEqual(origins(f.slot), ['https+++bank.example', 'https+++github.com'])
})

test('sites.txt limits the copy to a domain and its subdomains', () => {
  const f = fixture()
  writeFileSync(join(f.home, 'sites.txt'), '# work logins\nGitHub.com\n')
  assert.equal(sync(f).status, 0)
  assert.deepEqual(cookieHosts(f.slot), ['.github.com', 'api.github.com'])
  assert.deepEqual(origins(f.slot), ['https+++github.com'])
})

test('a narrower limit removes logins from an earlier sync', () => {
  const f = fixture()
  assert.equal(sync(f).status, 0)
  writeFileSync(join(f.home, 'sites.txt'), 'github.com')
  assert.equal(sync(f).status, 0)
  assert.deepEqual(cookieHosts(f.slot), ['.github.com', 'api.github.com'])
  assert.deepEqual(origins(f.slot), ['https+++github.com'])
})

test('a limit removes logins that the agent made itself', () => {
  const f = fixture()
  assert.equal(sync(f).status, 0)
  cookieDb(join(f.slot, 'cookies.sqlite'), ['agent.example'])
  writeFileSync(join(f.home, 'sites.txt'), 'github.com')
  assert.equal(sync(f).status, 0)
  assert.ok(!cookieHosts(f.slot).includes('agent.example'))
})

test('a wider limit brings logins back', () => {
  const f = fixture()
  writeFileSync(join(f.home, 'sites.txt'), 'github.com')
  assert.equal(sync(f).status, 0)
  writeFileSync(join(f.home, 'sites.txt'), 'github.com\nbank.example\n')
  assert.equal(sync(f).status, 0)
  assert.ok(cookieHosts(f.slot).includes('.bank.example'))
  assert.deepEqual(origins(f.slot), ['https+++bank.example', 'https+++github.com'])
})

test('GHOSTFOX_SITES wins over sites.txt', () => {
  const f = fixture()
  writeFileSync(join(f.home, 'sites.txt'), 'github.com')
  assert.equal(sync(f, { GHOSTFOX_SITES: 'bank.example' }).status, 0)
  assert.deepEqual(cookieHosts(f.slot), ['.bank.example'])
})

test('a sites.txt without domains means no sites', () => {
  const f = fixture()
  assert.equal(sync(f).status, 0)
  writeFileSync(join(f.home, 'sites.txt'), '# nothing for now\n')
  assert.equal(sync(f).status, 0)
  assert.deepEqual(cookieHosts(f.slot), [])
  assert.deepEqual(origins(f.slot), [])
})

test('the limit applies when the main profile is missing', () => {
  const f = fixture()
  assert.equal(sync(f).status, 0)
  writeFileSync(join(f.home, 'sites.txt'), 'github.com')
  assert.equal(sync({ ...f, source: join(f.home, 'gone') }).status, 0)
  assert.deepEqual(cookieHosts(f.slot), ['.github.com', 'api.github.com'])
})

test('sync fails if a locked profile blocks the limit', () => {
  const f = fixture()
  assert.equal(sync(f).status, 0)
  writeFileSync(join(f.home, 'sites.txt'), 'github.com')
  const lock = new DatabaseSync(join(f.slot, 'cookies.sqlite'))
  lock.exec('BEGIN EXCLUSIVE')
  const result = sync(f)
  lock.exec('ROLLBACK')
  lock.close()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /could not apply the login limit/)
})

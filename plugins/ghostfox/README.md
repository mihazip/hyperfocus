# ghostfox

A headless Firefox for Claude that is logged in wherever your everyday Firefox
is. No window and no extension. It runs only while Claude is using it, and
your own Firefox can stay open the whole time.

It wraps Mozilla's [firefox-devtools-mcp](https://github.com/mozilla/firefox-devtools-mcp).
Before Firefox launches, ghostfox copies the cookies and localStorage of your
main Firefox profile into a separate agent profile. Your main profile is only
read, never written.

## Install

Inside Claude Code:

```
/plugin install ghostfox --marketplace mihazip/hyperfocus
```

Restart Claude Code. The tools show up as `mcp__plugin_ghostfox_ghostfox__*`
(`navigate_page`, `take_snapshot`, `click_by_uid`, `fill_by_uid`,
`screenshot_page`, `get_page_text`, `evaluate_script`, ...). Ask Claude to open
a page.

Needs Node 22.13+ (for `node:sqlite`) and Firefox. The first start installs the
MCP into `~/.ghostfox/runtime` (with pnpm if present, else npm) and downloads
geckodriver into `~/.ghostfox/bin`.

## How it works

- Each Claude session claims its own agent profile in `~/.ghostfox/profiles/<n>`,
  so parallel sessions don't fight over one Firefox.
- On the first tool call, the moment Firefox launches, it syncs from your main
  profile (the one `profiles.ini` marks as default):
  - `cookies.sqlite`: every cookie is merged in. On a conflict your main
    profile wins, and logins the agent made itself are kept.
  - `storage/default/<origin>/ls`: localStorage of every web origin, copied
    again only when it changed. IndexedDB and extension storage are not copied.
- The first sync takes about 10 s for a big profile, later ones under a second.
- Calling `close_firefox_session` and then any other tool relaunches Firefox
  with fresh logins.

## Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `GHOSTFOX_SITES` | all | Comma list of domains whose logins get copied, e.g. `github.com,youtube.com`. Subdomains count. |
| `GHOSTFOX_SOURCE_PROFILE` | from `profiles.ini` | Path of the Firefox profile to copy from. |
| `GHOSTFOX_HEADLESS` | `1` | `0` shows the agent's Firefox window, for debugging. |
| `GHOSTFOX_FIREFOX` | auto-detected | Path to `firefox.exe` / `firefox`. |
| `GHOSTFOX_HOME` | `~/.ghostfox` | Where profiles, the MCP and geckodriver live. |

Extra arguments after `ghostfox.mjs` in `.mcp.json` go to firefox-devtools-mcp,
e.g. `--tool-preset slim` to drop `evaluate_script`.

## Be aware

- **Your sessions, Claude's hands.** With the default settings the agent can act
  as you on every site you are logged in to. Text on any page it reads can try
  to steer it (prompt injection). Use `GHOSTFOX_SITES` to hand over only the
  logins a task needs. It limits which logins are copied, not where the agent
  can browse.
- `~/.ghostfox/profiles` holds copies of your cookies. Treat it like your
  Firefox profile.
- Some sites (Google, banks) may notice the same session used from a second
  browser and ask you to sign in again.
- Sync is one-way: logins made in the agent never reach your own Firefox.
- The agent's Firefox runs under WebDriver, so `navigator.webdriver` is true and
  strict bot checks may block it.

Part of the [hyperfocus](../../README.md) collection.

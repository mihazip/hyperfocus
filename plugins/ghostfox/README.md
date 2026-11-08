# ghostfox

A headless Firefox for Claude that can use the logins of your everyday Firefox,
but only for the sites that you allow in a session. No window and no
extension. It runs only while Claude is using it, and your own Firefox can stay
open the whole time.

It wraps Mozilla's [firefox-devtools-mcp](https://github.com/mozilla/firefox-devtools-mcp).
A session starts logged out everywhere. When you type
`/ghostfox:logins github.com`, ghostfox copies the cookies and localStorage of
that site from your main Firefox profile into a separate agent profile. Your
main profile is only read, never written.

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

- Sessions that never browse cost nothing: no profile, no Firefox. At the first
  tool call a session claims its own agent profile in `~/.ghostfox/profiles/<n>`
  (up to 8 at once), so parallel sessions don't fight over one Firefox.
- A session starts with **no logins**. You give it logins with `/ghostfox:logins`
  (see below). Each tool call checks the grant again.
- When Firefox launches, ghostfox syncs the granted sites from your main
  profile (the one `profiles.ini` marks as default):
  - `cookies.sqlite`: the cookies of the granted sites. On a conflict your main
    profile wins.
  - `storage/default/<origin>/ls`: localStorage of the granted web origins,
    copied again only when it changed. IndexedDB and extension storage are not
    copied.
- Before each sync, ghostfox removes the cookies and site storage of all other
  sites from the agent profile. This includes logins that the agent made itself.
- The first result after each launch tells Claude in plain words which logins
  the browser has, so Claude can tell you.
- Calling `close_firefox_session` and then any other tool relaunches Firefox
  with fresh logins.

## Give logins to a session

Type the command yourself. Claude cannot run it (`disable-model-invocation`).

```
/ghostfox:logins github.com dash.cloudflare.com
/ghostfox:logins            # show the logins of this session
/ghostfox:logins off        # remove them
```

The command answers in plain words, for example: "This Claude Code session can
use your Firefox logins for github.com and dash.cloudflare.com (with
subdomains). Every other site opens logged out."

- The grant belongs to one Claude Code process (`$CLAUDE_PID`), and is stored in
  `~/.ghostfox/grants/<pid>.txt`. Other sessions do not get it.
- A new list replaces the old list. If the agent browser is open, it restarts at
  the next browser call, and its open pages close.
- The grant ends when the Claude Code session ends. An MCP restart (for example
  `/reload-plugins`) also clears it. Then type the command again.
- Subdomains count. You can paste a URL: `https://www.github.com/x` becomes
  `github.com`. A site that signs in through another domain, such as Google,
  needs that domain too.
- The grant limits which logins the agent has, not where it can browse.
- If the grant cannot be applied, Firefox does not start and the tool call
  returns an error. The usual cause is an old Firefox process that holds the
  profile. Stop that process and try again.

## Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `GHOSTFOX_SITES` | not set | Comma list of domains that every session gets without `/ghostfox:logins`, for example for `claude -p`. A grant replaces it. A change needs a restart. |
| `GHOSTFOX_SOURCE_PROFILE` | from `profiles.ini` | Path of the Firefox profile to copy from. |
| `GHOSTFOX_HEADLESS` | `1` | `0` shows the agent's Firefox window, for debugging. |
| `GHOSTFOX_FIREFOX` | auto-detected | Path to `firefox.exe` / `firefox`. |
| `GHOSTFOX_HOME` | `~/.ghostfox` | Where profiles, the MCP and geckodriver live. |

Extra arguments after `ghostfox.mjs` in `.mcp.json` go to firefox-devtools-mcp,
e.g. `--tool-preset slim` to drop `evaluate_script`.

## Be aware

- **Your sessions, Claude's hands.** On a granted site the agent can act as you.
  Text on any page it reads can try to steer it (prompt injection). Give only
  the logins a task needs. Do not give email, bank or password-manager logins:
  a session there opens all your other accounts.
- **The grant is a guard, not a wall.** It stops Claude from using your logins
  on its own initiative, or because a web page tells it to. It does not stop an
  agent that is set on getting around it: any agent with shell access runs as
  your user and can read your Firefox profile directly. Keep your Claude Code
  permission prompts on for that.
- `~/.ghostfox/profiles` holds copies of your cookies. Treat it like your
  Firefox profile.
- Some sites (Google, banks) may notice the same session used from a second
  browser and ask you to sign in again.
- Sync is one-way: logins made in the agent never reach your own Firefox.
- The agent's Firefox runs under WebDriver, so `navigator.webdriver` is true and
  strict bot checks may block it.

Part of the [hyperfocus](../../README.md) collection.

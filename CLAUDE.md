# hyperfocus: project notes

A marketplace of Claude Code mods (plugins with a hooks module) for side questions that never touch the main thread. Shared on GitHub as `mihazip/hyperfocus` (renamed from `mihazip/adhd`; GitHub redirects the old URL).

## Layout

- `.claude-plugin/marketplace.json`: the marketplace, named `hyperfocus`. One entry per plugin, `source: ./plugins/<name>`.
- `plugins/aside/`: `/aside` side pane (was `adhd`). `hooks/register.tsx` wires `session.start` (registers `/aside`, loads model/effort from `$.store`), `command.run` (opens the pane) and `ui.render` for the Pane. `types/index.d.ts`: `PluginState.aside` and `Exchange`. `tests/aside.test.tsx`.
- `plugins/tangent/`: inline `|| question ||` (aliases `\\\ … \\\`, `/// … ///`). `hooks/register.tsx` hooks `prompt.edit` (space after the closing delimiter starts a job), `prompt.submit` (holds a prompt until its answers land), `/tangent <code>` sets the default model+level, `/tangent delims` opens the delimiter picker pane. `tests/tangent.test.ts`.
- `plugins/ghostfox/`: no hooks, an MCP server (`.mcp.json`). `bin/ghostfox.mjs` installs `@mozilla/firefox-devtools-mcp` (pinned `MCP_VERSION`) into `~/.ghostfox/runtime` and geckodriver into `~/.ghostfox/bin`, starts it without a profile and relays stdio to it (its stdout goes through a line relay). At the first `tools/call` it claims a slot in `~/.ghostfox/profiles/<n>` (pid file, max 8), restarts the MCP with `--profile-path` on it (replaying the client's `initialize` under id `ghostfox-init`, whose reply is swallowed), merges the main profile's `cookies.sqlite` and copies changed `storage/default/*/ls` folders. If no slot is free, that call returns an `isError` result and the next call tries again. `node plugins/ghostfox/bin/ghostfox.mjs sync` runs one sync for testing (set `GHOSTFOX_HOME` to a scratch folder).
- `README.md`: the collection page. Each plugin has its own README with a `/plugin install <name> --marketplace mihazip/hyperfocus` line.

## Rules for editing

- `$` may only be passed to top-level function declarations, never closures. Keep helpers top-level and take `$: EngineInterface` as the first argument.
- State lives in atoms (`atom/read/update` from `claude-code`), keyed `{ plugin: '<name>', key }`. Add new keys to that plugin's `types/index.d.ts`. The contract must be self-contained (no imports). Settings that must survive restarts go in `$.store` too.
- Hooks have a 10 s budget and `$.clock.sleep` counts against it: long work goes in `$.clock.after` callbacks, not in a waiting hook.
- Write backslashes and non-ASCII (the braille bird) with the Write/Edit tools, not shell heredocs: the shell halves backslashes.
- Validate: `claude plugin validate .` (marketplace) and `claude plugin validate plugins/<name>`. Test: `claude plugin test plugins/<name>`.
- Never commit secrets, session ids or local paths. Commit with the GitHub noreply email only.
- Hot reload during development: copy a plugin folder into `~/.claude/dev-mods/<session-id>/<name>`. It is session-scoped.

## Install and testing

`claude plugin marketplace add <path to this folder>`, then `claude plugin install aside@hyperfocus` and `claude plugin install tangent@hyperfocus`. The marketplace serves whatever branch this folder has checked out, and `/reload-plugins` re-reads it. To try several feature branches together, merge them into a throwaway local branch (e.g. `local/try`, never pushed), check it out here, and have the user `/reload-plugins`; switch back to `main` afterwards.

## Decisions

- Palette: both plugins use one top-level `THEME` with the user's Windows Terminal "Ubuntu" scheme (bg `#300A24`, fg `#EEEEEC`, accent `#E9AD0C`, info `#33C7DE`). Every Text and every Button label carries an explicit color and background: the engine marks focus by inverting the label's colors, and with terminal defaults that came out black on dark gray. `Input` and `Markdown` take no color props. Other users change `THEME` themselves.
- Panes are never opened with `closeOnEscape`: Esc hands the keys back to the prompt and the pane keeps its content. Close with the Close/done button or the pane's close mark.
- No `Select` in panes: it captures Up/Down. Choices are cycling Buttons (`Model: ‹ sonnet ›`, Enter steps). Panes get no left/right key events: the arrows only walk the focus ring, and `ui.focus` carries no direction.
- No `AbovePrompt` band button: the band is one shared slot that already holds the engine's context row; a band hook (even wrapping `next(e)`) never showed the button. Abandoned.
- aside: models `haiku sonnet opus fable`, effort `low medium high`, both persisted in `$.store`; the synopsis always runs on `SYNOPSIS_MODEL` (haiku, low), only for answers over 400 chars. Each question carries the pane's last 6 exchanges, nothing of the main session. Braille hummingbird (6 rows) flutters ~1.5 s on open, shown only on the empty pane. The unsent draft lives in the `draft` atom.
- tangent: default `hh` (haiku, high); codes are model letter `h s o f` + level `l m h x`, `xx` = max. Context ~20k chars before + 2k after, reply cap 3000 tokens (~10k per side session). The prompt tells the model to answer a question in the spot, never continue the sentence.
- tangent delimiters: built-ins `||` (default), `\\\`, `///`, each switchable off (at least one stays on); custom pairs in `$.store` key `pairs`, disabled built-ins in `off`. Nothing fires inside backticks or code fences, and every pair except the two aliases needs a question of 2+ words, so `a || b || ` in code stays safe.
- ghostfox: nothing may write to stdout except the MCP child, because stdout is the MCP stream. That's why geckodriver is fetched up front (the MCP's own fallback download logs to stdout) and the runtime install sends its output to stderr. Install uses `--ignore-scripts`, since pnpm 11 fails on geckodriver's postinstall. `remote.prefs.recommended=false` keeps the agent close to a normal Firefox; `user.js` in each slot turns off first-run pages. Open bug (Windows, already in 0.1.0): when the MCP shuts down on stdin end, geckodriver dies but the headless Firefox keeps running and holds the slot's profile. Fix idea: on release, and when taking over a stale slot, kill Firefox processes whose command line has `--profile <slot>`.

## Roadmap for aside (not built yet)

1. **Themes.** Built-in named themes beside Ubuntu (Dracula, light), picked from the pane and persisted.
2. **`?` commands in the pane:** `?theme <name>`, `?themes`, `?model <alias>`, `?effort <level>`, `?settings`, `?help`.
3. A cheaper way to open the pane than `/aside` (no global shortcut API exists; a `prompt.edit` trigger like `?? ` was tried and removed).
4. Tests for `ask` (history trimming, synopsis cap at 300 chars, busy lock).

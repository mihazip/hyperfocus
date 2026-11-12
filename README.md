# hyperfocus

Claude Code mods for keeping your focus while many agents work for you.

When you orchestrate several Claude sessions at once, small questions keep
pulling you away: a fact, a name, a quick check. These mods answer them on the
side, with a small model and a tight budget, so the main thread's context and
your train of thought stay where they were.

| Mod | What it does |
| --- | --- |
| [aside](plugins/aside) | `/aside` opens a side pane with its own input box. Ask Haiku anything; optionally send a short synopsis back to your prompt. |
| [tangent](plugins/tangent) | Type a question between pipes mid-sentence (`|| like this ||`; `\\\` and `///` work too). A space after the closing pipes asks in the background and writes the answer into your draft in place. |
| [ghostfox](plugins/ghostfox) | A headless Firefox for Claude, with no window and no extension. It starts logged out. `/ghostfox:logins <sites>` copies the cookies and localStorage of those sites from your everyday Firefox, for one session. |
| [usage-weather](plugins/usage-weather) | One line above the prompt: a weather forecast of the context window, and the 5-hour, weekly and spend limits of your account. |

## Install

Inside Claude Code:

```
/plugin marketplace add mihazip/hyperfocus
/plugin install aside@hyperfocus
/plugin install tangent@hyperfocus
/plugin install ghostfox@hyperfocus
/plugin install usage-weather@hyperfocus
```

Restart Claude Code after installing.

## License

MIT, except [usage-weather](plugins/usage-weather), which is Apache-2.0.

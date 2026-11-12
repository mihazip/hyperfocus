# usage-weather

A Claude Code mod that shows the context window and the account limits on one
line above the prompt.

```
 ☂  Showers  67% of context  134.4k / 200k  │  5h 24% ↻ 14:30  │  week 41% ↻ Sat 09:00  │  ▁▂█  ▲ +98.4k
```

## Install

Inside Claude Code:

```
/plugin install usage-weather --marketplace mihazip/hyperfocus
```

Restart Claude Code. Part of the [hyperfocus](../../README.md) collection.

## What the line shows

- The forecast: an icon and a word for the fill of the context window, the
  percentage, and the tokens used of the window.
- The limits: one entry for each rate-limit window that the last API response
  reported. `5h` is the 5-hour window, `week` is the 7-day window, and `spend`
  is the spend limit of a Claude gateway. A different window shows under its
  own name.
- The chart: the last 12 context readings as block characters, and the change
  of the last turn.

| Context used | Forecast |
| --- | --- |
| below 25% | ☀ Clear |
| 25 to 49% | ☁ Cloudy |
| 50 to 74% | ☂ Showers |
| 75 to 89% | ☇ Storm |
| 90% or more | ↯ Compact soon |

A limit is green below 50%, yellow from 50%, and red from 80%.

The line adapts to the width of the band. Below 110 columns it drops the reset
times (`↻`). Below 80 columns it drops the chart.

## Limitations

- There is no monthly window. The engine reports only the windows of the
  account: `five_hour`, `seven_day`, and `spend_limit` on a gateway.
- The limits are empty when the account is not on a subscription, and before
  the first response of a session.
- The band is one shared slot. Disable `token-weather` and other mods that draw
  the band above the prompt.
- The context percentage is of the full window. The notice of Claude Code counts
  to the auto-compact point, which is lower.

## Credits

The forecast is a fork of Token Weather from
[anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground)
(Copyright 2026 Anthropic PBC, Apache-2.0). This mod has the same license.

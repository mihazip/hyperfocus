// Usage Weather: the context forecast and the account limits on one line above the prompt.
//
// The context part is a fork of Token Weather from anthropics/claude-code-playground
// (Copyright 2026 Anthropic PBC, Apache-2.0). The limits part and the atoms are new.
//
// session.start: take a first reading, so the band shows before the first turn.
// session.measure: the engine pushes the context fill and the rate-limit windows.
// ui.render (AbovePrompt): draw one line from the two atoms.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, Reading } from '../types'

const HISTORY = 12
const BARS = '▁▂▃▄▅▆▇█'
// Windows Terminal 'Ubuntu' scheme, the same as the other hyperfocus mods; change here for another palette.
const THEME = {
  fg: '#EEEEEC',
  dim: '#D0CFCC',
  accent: '#E9AD0C',
  info: '#33C7DE',
  blue: '#2A7BDE',
  magenta: '#C061CB',
  red: '#F66151',
  green: '#26A269',
} as const
// Forecast bands, by percent of the context window used. The icons are single-width text symbols, not emoji.
const FORECAST = [
  { upTo: 25, icon: '☀', word: 'Clear', color: THEME.accent },
  { upTo: 50, icon: '☁', word: 'Cloudy', color: THEME.info },
  { upTo: 75, icon: '☂', word: 'Showers', color: THEME.blue },
  { upTo: 90, icon: '☇', word: 'Storm', color: THEME.magenta },
  { upTo: Infinity, icon: '↯', word: 'Compact soon', color: THEME.red },
] as const
// The limit windows the engine reports, in the order of the line. An unknown kind shows under its own name.
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'week', spend_limit: 'spend' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
// Below these widths the line drops the reset times, then the chart.
const WIDE = 110
const MEDIUM = 80

export type Part = { text: string; color: string; isBold?: boolean }

const readings = atom({ plugin: 'usage-weather', key: 'readings' } as const, [] as Reading[])
const limits = atom({ plugin: 'usage-weather', key: 'limits' } as const, [] as Limit[])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await takeFirstReading($)

    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      await update($, readings, list => addReading(list, e.context))
    }
    await update($, limits, () => e.rateLimits.map(toLimit))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, readings)
    const windows = await read($, limits)

    if (e.props.hasSurvey || (list.length === 0 && windows.length === 0)) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" paddingX={1}>
        {line(list, windows, e.props.bodyColumns ?? 80).map((part, index) => (
          <Text key={String(index)} color={part.color} bold={part.isBold === true}>
            {part.text}
          </Text>
        ))}
      </Box>
    )
  })
}

// A reload or /clear runs session.start again. An empty window starts the history over.
async function takeFirstReading($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage()
    const isEmpty = !usage.context.tokens
    await update($, readings, list => addReading(isEmpty ? [] : list, usage.context))
    await update($, limits, () => usage.rateLimits.map(toLimit))
  } catch {
    // No reading now. The first session.measure brings one.
  }
}

function toLimit(limit: Limit): Limit {
  return limit.resetsAt === undefined
    ? { kind: limit.kind, percentUsed: limit.percentUsed }
    : { kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt }
}

// Readings stay oldest first. The 0 reading from before the first response goes away when a real one arrives.
export function addReading(
  list: readonly Reading[],
  context: { tokens?: number; window: number; percent?: number },
): Reading[] {
  if (!context.window) {
    return [...list]
  }
  const tokens = context.tokens ?? 0
  const percent = Math.round(context.percent ?? (tokens / context.window) * 100)
  const kept = list.filter(reading => reading.tokens > 0)
  const last = kept[kept.length - 1]
  if (last !== undefined && last.tokens === tokens && last.window === context.window) {
    return kept
  }

  return [...kept, { tokens, window: context.window, percent }].slice(-HISTORY)
}

// The whole band as colored parts: forecast, limits, then the chart of the last turns.
export function line(list: readonly Reading[], windows: readonly Limit[], columns: number): Part[] {
  const parts: Part[] = []
  const now = list[list.length - 1]
  const color = now === undefined ? THEME.dim : forecastFor(now.percent).color

  if (now !== undefined) {
    const forecast = forecastFor(now.percent)
    parts.push({ text: `${forecast.icon}  ${forecast.word}`, color, isBold: true })
    parts.push({ text: `  ${now.percent}% of context`, color: THEME.fg })
    parts.push({ text: `  ${short(now.tokens)} / ${short(now.window)}`, color: THEME.dim })
  }

  for (const limit of sortLimits(windows)) {
    parts.push({ text: parts.length === 0 ? '' : '  │  ', color: THEME.dim })
    parts.push({ text: `${LABELS[limit.kind] ?? limit.kind.replaceAll('_', ' ')} `, color: THEME.dim })
    parts.push({ text: `${Math.round(limit.percentUsed)}%`, color: limitColor(limit.percentUsed), isBold: true })
    const reset = columns >= WIDE ? resetWord(limit) : ''
    if (reset !== '') {
      parts.push({ text: ` ↻ ${reset}`, color: THEME.dim })
    }
  }

  if (columns >= MEDIUM && list.length > 0) {
    parts.push({ text: '  │  ', color: THEME.dim })
    parts.push({ text: chart(list), color })
    const trend = trendWord(list)
    if (trend !== '') {
      parts.push({ text: `  ${trend}`, color: THEME.dim })
    }
  }

  return parts
}

function forecastFor(percent: number): (typeof FORECAST)[number] {
  return FORECAST.find(band => percent < band.upTo) ?? FORECAST[4]
}

function sortLimits(windows: readonly Limit[]): Limit[] {
  const order = Object.keys(LABELS)
  const rank = (kind: string): number => (order.includes(kind) ? order.indexOf(kind) : order.length)

  return [...windows].sort((a, b) => rank(a.kind) - rank(b.kind))
}

function limitColor(percent: number): string {
  if (percent >= 80) return THEME.red
  if (percent >= 50) return THEME.accent

  return THEME.green
}

// The local time of the reset: the clock time when it is within a day, the weekday when it is later.
export function resetWord(limit: Limit, nowMs: number = Date.now()): string {
  if (limit.resetsAt === undefined) {
    return ''
  }
  const at = new Date(limit.resetsAt)
  const ms = at.getTime()
  if (Number.isNaN(ms) || ms <= nowMs) {
    return ''
  }
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`

  return ms - nowMs < 24 * 3_600_000 ? clock : `${DAYS[at.getDay()]} ${clock}`
}

// Bars scale to the fullest reading shown, so growth shows at any fill level.
function chart(list: readonly Reading[]): string {
  const top = Math.max(...list.map(reading => reading.tokens), 1)

  return list
    .map(reading => BARS[Math.min(BARS.length - 1, Math.floor((reading.tokens / top) * (BARS.length - 1)))])
    .join('')
}

function trendWord(list: readonly Reading[]): string {
  const last = list[list.length - 1]
  const previous = list[list.length - 2]
  if (last === undefined || previous === undefined) {
    return ''
  }
  const delta = last.tokens - previous.tokens
  if (delta > 0) return `▲ +${short(delta)}`
  if (delta < 0) return `▼ ${short(-delta)}`

  return 'steady'
}

export function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`

  return String(n)
}

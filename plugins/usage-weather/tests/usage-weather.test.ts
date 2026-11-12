import { expect, test } from 'claude-code/testing'

import { addReading, line, resetWord, short } from '../hooks/register'

const text = (parts: { text: string }[]): string => parts.map(part => part.text).join('')

test('the line shows the forecast, the limits in order and the chart', () => {
  const readings = [
    { tokens: 36_000, window: 200_000, percent: 18 },
    { tokens: 134_400, window: 200_000, percent: 67 },
  ]
  const limits = [
    { kind: 'seven_day', percentUsed: 41.2 },
    { kind: 'spend_limit', percentUsed: 85 },
    { kind: 'five_hour', percentUsed: 23.5 },
  ]
  const shown = text(line(readings, limits, 90))

  expect(shown).toContain('☂  Showers  67% of context  134.4k / 200k')
  expect(shown).toContain('5h 24%  │  week 41%  │  spend 85%')
  expect(shown).toContain('▂█  ▲ +98.4k')
})

test('a narrow band drops the chart and keeps the limits', () => {
  const shown = text(
    line([{ tokens: 10_000, window: 1_000_000, percent: 1 }], [{ kind: 'five_hour', percentUsed: 7 }], 60),
  )

  expect(shown).toBe('☀  Clear  1% of context  10k / 1M  │  5h 7%')
})

test('limits show alone before the first context reading', () => {
  expect(text(line([], [{ kind: 'five_hour', percentUsed: 3 }], 60))).toBe('5h 3%')
})

test('a wide band adds the reset time', () => {
  const soon = new Date(Date.now() + 2 * 3_600_000).toISOString()
  const shown = text(line([], [{ kind: 'five_hour', percentUsed: 3, resetsAt: soon }], 140))

  expect(shown).toMatch(/^5h 3% ↻ \d\d:\d\d$/)
})

test('a reset later than a day shows the weekday, a past one shows nothing', () => {
  const now = Date.parse('2026-11-12T10:00:00Z')

  expect(resetWord({ kind: 'seven_day', percentUsed: 1, resetsAt: '2026-11-15T10:00:00Z' }, now)).toMatch(
    /^(Sat|Sun|Mon) \d\d:\d\d$/,
  )
  expect(resetWord({ kind: 'seven_day', percentUsed: 1, resetsAt: '2026-11-11T10:00:00Z' }, now)).toBe('')
  expect(resetWord({ kind: 'seven_day', percentUsed: 1 }, now)).toBe('')
})

test('readings drop the zero start, skip repeats and keep the last 12', () => {
  let list = addReading([], { window: 200_000 })
  expect(list).toEqual([{ tokens: 0, window: 200_000, percent: 0 }])

  list = addReading(list, { tokens: 50_000, window: 200_000, percent: 25 })
  expect(list).toEqual([{ tokens: 50_000, window: 200_000, percent: 25 }])
  expect(addReading(list, { tokens: 50_000, window: 200_000, percent: 25 })).toHaveLength(1)

  for (let turn = 1; turn <= 20; turn += 1) {
    list = addReading(list, { tokens: 50_000 + turn, window: 200_000 })
  }
  expect(list).toHaveLength(12)
  expect(list[11]?.tokens).toBe(50_020)
})

test('short numbers', () => {
  expect(short(999)).toBe('999')
  expect(short(134_400)).toBe('134.4k')
  expect(short(1_000_000)).toBe('1M')
})

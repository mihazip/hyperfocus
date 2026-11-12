export type Reading = { tokens: number; window: number; percent: number }

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-weather': {
      readings: Reading[]
      limits: Limit[]
    }
  }
}

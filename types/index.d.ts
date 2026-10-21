export type Checklist = { doneMeans: string; warnings: string[]; isArmed: boolean; checksUsed: number }
export type Offer = { doneMeans: string; tokens: number }
export type DoneStatus = 'met' | 'not met' | 'not shown' | 'in progress'
export type WarningStatus = 'dealt with' | 'still open' | 'unknown'
export type Verdict = {
  done: DoneStatus
  evidence: string
  warnings: { text: string; status: WarningStatus; why: string }[]
  notes: string[]
  tokens: number
}

declare module 'claude-code' {
  interface PluginState {
    tighten: { checklist: Checklist | null; verdict: Verdict | null; offer: Offer | null; isPersonsTurn: boolean }
  }
}

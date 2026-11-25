import type { LucideIcon } from 'lucide-react'
import { Sparkles, Tag, Megaphone, ShieldAlert } from 'lucide-react'
import type { BattlecardReport, Claim } from '@/lib/api'

export type PillarKey = 'new_features' | 'pricing_changes' | 'marketing_message' | 'objections_or_risks'

export interface Pillar {
  key: PillarKey
  label: string
  icon: LucideIcon
  className: string
}

// The 4 fixed competitive-intelligence pillars. Do not add/restructure without
// confirming with the product owner (see project handoff notes).
export const pillars: Pillar[] = [
  {
    key: 'new_features',
    label: 'New Features Announced',
    icon: Sparkles,
    className: 'bg-secondary text-secondary-foreground',
  },
  {
    key: 'pricing_changes',
    label: 'Pricing & Packaging',
    icon: Tag,
    className: 'bg-secondary text-secondary-foreground',
  },
  {
    key: 'marketing_message',
    label: 'Core Marketing Message',
    icon: Megaphone,
    className: 'bg-secondary text-secondary-foreground',
  },
  {
    key: 'objections_or_risks',
    label: 'Potential Risks / Weaknesses',
    icon: ShieldAlert,
    className: 'bg-secondary text-secondary-foreground',
  },
]

export function pillarValue(report: BattlecardReport, key: PillarKey): Claim[] {
  return report[key]
}

// Failure marker: mirrors
// `_INCOMPLETE_MARKER` in src/agents/llm_agent.py exactly. The backend
// writes this literal string as a claim's `text` for every pillar of a
// chunk whose LLM call failed outright, specifically so it survives
// dedup/aggregation and shows up here instead of a chunk just silently
// contributing nothing. Never render this string as if it were a real
// extracted claim — always render the badge below instead.
export const INCOMPLETE_MARKER = '[INCOMPLETE - API ERROR]'

export function isIncompleteClaim(claim: Claim): boolean {
  return claim.text === INCOMPLETE_MARKER
}

/** True if ANY pillar of this report contains an unrecovered LLM-failure marker claim. */
export function reportHasIncompleteAnalysis(report: BattlecardReport): boolean {
  return pillars.some((pillar) => pillarValue(report, pillar.key).some(isIncompleteClaim))
}

/** Formats a Whisper timestamp (seconds) as "MM:SS" for citation labels. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

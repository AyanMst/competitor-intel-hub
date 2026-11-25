import { AlertTriangle, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTimestamp, isIncompleteClaim, type Pillar } from './pillar-data'
import type { Claim } from '@/lib/api'

interface PillarCardProps {
  pillar: Pillar
  value: Claim[]
  fileName: string | null
  /** Called with a claim's timestamp when its citation is clicked; only
   * claims with a non-null timestamp render as clickable (mp4-sourced only). */
  onCitationClick?: (timestamp: number) => void
}

export function PillarCard({ pillar, value, fileName, onCitationClick }: PillarCardProps) {
  const Icon = pillar.icon
  const isEmpty = value.length === 0

  return (
    <article className="group relative flex flex-col rounded-2xl border border-border bg-card p-7 shadow-soft transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-soft-lg">
      {/* Top row: pillar category chip */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
            pillar.className,
          )}
        >
          <Icon className="size-3.5" />
          {pillar.label}
        </span>
      </div>

      {/* Body */}
      <div className="mt-4 flex flex-1 flex-col gap-3">
        {isEmpty ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Nothing was called out for this pillar in the analyzed video.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {value.map((claim, index) => (
              <li
                key={index}
                className="flex items-start gap-2 text-sm leading-relaxed text-foreground"
              >
                {isIncompleteClaim(claim) ? (
                  // Failure marker: this pillar's LLM call
                  // failed outright for one transcript chunk — surface it
                  // as a visible, actionable badge instead of the raw
                  // `[INCOMPLETE - API ERROR]` marker text.
                  <span
                    title="One chunk of this video's transcript could not be analyzed (LLM/API error). Re-run the analysis to retry it."
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-400"
                  >
                    <AlertTriangle className="size-3.5" />
                    Incomplete — retry analysis
                  </span>
                ) : (
                  <>
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/50" />
                    {claim.timestamp !== null ? (
                      <button
                        type="button"
                        onClick={() => onCitationClick?.(claim.timestamp as number)}
                        title={`Jump to ${formatTimestamp(claim.timestamp)} in the transcript`}
                        className="text-left underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 transition-colors hover:text-primary hover:decoration-primary"
                      >
                        {claim.text}
                        <span className="ml-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                          <Clock className="size-3" />
                          {formatTimestamp(claim.timestamp)}
                        </span>
                      </button>
                    ) : (
                      <span>{claim.text}</span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer: source video */}
      {fileName ? (
        <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
          <p className="truncate text-xs font-medium text-muted-foreground">
            Extracted from <span className="text-foreground">{fileName}</span>
          </p>
        </div>
      ) : null}
    </article>
  )
}

import Link from 'next/link'
import { FileVideo } from 'lucide-react'

// Minimal shape the dashboard grid needs — deliberately not the full
// `ReportDetail` from lib/api.ts, since this card never fetches transcript/
// pillar data.
export interface ReportCardData {
  id: string
  filename: string
  created_at: string
  competitor_name: string | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

interface ReportCardProps {
  report: ReportCardData
}

/**
 * Basic, clean grid card for the Server Component dashboard. Links through to the report detail route.
 */
export function ReportCard({ report }: ReportCardProps) {
  return (
    <Link
      href={`/reports/${report.id}`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-soft-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileVideo className="size-4" />
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
          {report.competitor_name ?? 'Uncategorized'}
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground" title={report.filename}>
          {report.filename}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(report.created_at)}</p>
      </div>
    </Link>
  )
}

import Link from 'next/link'
import { FileX, ChevronLeft } from 'lucide-react'

// Rendered when ReportDetailPage's Supabase query finds no row (deleted,
// mistyped id, or belongs to another tenant — RLS makes those two
// indistinguishable on purpose, see page.tsx). Pure markup, no client
// interactivity, so this stays a Server Component.
export default function ReportNotFound() {
  return (
    <div className="mx-auto max-w-[1200px] px-5 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
        <FileX className="size-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium text-foreground">Report not found</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          This report doesn&apos;t exist or you don&apos;t have access to it.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <ChevronLeft className="size-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}

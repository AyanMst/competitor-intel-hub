import Link from 'next/link'
import { Compass } from 'lucide-react'

// Global 404 for any unmatched route. Pure markup — Server Component.
export default function GlobalNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card shadow-soft">
        <Compass className="size-6 text-muted-foreground" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-brand transition-all hover:-translate-y-px hover:bg-primary/90"
      >
        Back to Dashboard
      </Link>
    </div>
  )
}

import Link from 'next/link'
import { Sparkles } from 'lucide-react'

interface LegalPlaceholderProps {
  title: string
  lastUpdatedLabel?: string
}

/**
 * Shared chrome for /privacy and /terms. Copy inside is a scaffold only —
 * never treat it as a real policy. A real deployment would need reviewed text
 * from counsel or a policy generator.
 */
export function LegalPlaceholder({ title, lastUpdatedLabel = 'Demo only' }: LegalPlaceholderProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-foreground">
              <Sparkles className="size-3.5 text-background" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">Competitor Intel Hub</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12">
        <p className="inline-flex rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-semibold tracking-wide text-destructive uppercase">
          DEMO PLACEHOLDER — NOT A REAL LEGAL DOCUMENT.
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdatedLabel}</p>

        <div className="mt-8 space-y-6 text-sm leading-6 text-foreground">
          <section className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-4">
            <p className="font-semibold text-destructive">
              Demo placeholder — not a real legal document.
            </p>
            <p className="mt-2 text-muted-foreground">
              This page is a scaffold so the /privacy and /terms routes exist. It is not a privacy
              policy, terms of service, or any other legal agreement. Do not present this wording
              to users as authoritative. This is a portfolio demo; a production deployment would need
              reviewed copy from counsel or a policy generator.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold">1. Scope</h2>
            <p className="mt-2 text-muted-foreground">
              Demo placeholder — not a real legal document. Describe who this document applies
              to, which services it covers, and how it relates to the other legal page.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold">2. Information we collect</h2>
            <p className="mt-2 text-muted-foreground">
              Demo placeholder — not a real legal document. List account data, uploaded videos,
              transcripts, generated reports, billing identifiers, and any analytics — only after
              counsel or a generator has reviewed the actual processing.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold">3. How we use information</h2>
            <p className="mt-2 text-muted-foreground">
              Demo placeholder — not a real legal document.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold">4. Sharing and processors</h2>
            <p className="mt-2 text-muted-foreground">
              Demo placeholder — not a real legal document. Name vendors (hosting, auth, payments)
              only from the reviewed source, not from this scaffold.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold">5. Retention and account deletion</h2>
            <p className="mt-2 text-muted-foreground">
              Demo placeholder — not a real legal document. The product has a user-facing delete
              flow; the legal description of retention must come from reviewed copy, not from this
              placeholder.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold">6. Contact</h2>
            <p className="mt-2 text-muted-foreground">
              Demo placeholder — not a real legal document. Add a real contact address when the
              reviewed policy is pasted in.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}

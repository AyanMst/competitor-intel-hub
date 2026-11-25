import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  /** Already-built CTA (e.g. a `<Link>` or `<button>`) — kept as a ReactNode
   * so this stays usable from both Server and Client Component callers
   * without this file needing to own any navigation/click behavior itself. */
  action?: React.ReactNode
  className?: string
}

// Matches the dashed-border "No reports yet" card already on
// app/dashboard/page.tsx — pure markup, no hooks, so any Server Component
// list view can render it directly.
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center' +
        (className ? ` ${className}` : '')
      }
    >
      <Icon className="size-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

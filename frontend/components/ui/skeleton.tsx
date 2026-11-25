import { cn } from '@/lib/utils'

// Pure markup, no hooks/handlers — safe to render from a Server Component
// (e.g. app/*/loading.tsx). Uses the same `bg-muted` token as every other
// placeholder/disabled surface in the app, so it never looks like a new
// design system bolted on top of the existing one.
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}

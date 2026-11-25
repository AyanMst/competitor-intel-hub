'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Single app-wide QueryClient (one per browser tab, created lazily via
// `useState` so it survives re-renders but not full page reloads). Needs
// `'use client'` because QueryClientProvider is a React context provider —
// everything else in `layout.tsx` stays a Server Component; only the
// subtree that actually calls `useQuery`/`useMutation` needs to run here.
// Replaces the page-scoped QueryClient that `ChannelList` used to create
// for itself, so every data-fetching Client Component (ChannelList,
// ReportsList, the onboarding modal, future ones) shares one cache instead
// of each spinning up its own.
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

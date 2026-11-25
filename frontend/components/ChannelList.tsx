'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Radar, Loader2, Plus, Power, PowerOff, Trash2 } from 'lucide-react'
import { apiFetch, ApiError } from '@/lib/api'
import { EmptyState } from '@/components/ui/empty-state'

// Minimal shape app/channels/page.tsx (Server Component) hands down, already
// flattened (competitor name joined in, same as the FastAPI GET /channels
// shape from src/storage/channels_repository.py's `list_channels`).
export interface ChannelRow {
  id: string
  channel_url: string
  channel_name: string | null
  competitor_name: string | null
  is_active: boolean
  last_checked_at: string | null
  created_at: string
}

interface ChannelListProps {
  initialChannels: ChannelRow[]
}

/**
 * Channels CRUD. Add / Toggle Active /
 * Delete are wired end-to-end via `apiFetch` against the PATCH/DELETE
 * /channels/{id} endpoints (api.py), using `@tanstack/react-query`
 * `useMutation` for each action — reading the shared `QueryClient` from
 * `app/providers.tsx` rather than creating its own, now that it's not the
 * only react-query consumer in the app. `router.refresh()` after every
 * mutation re-runs the parent Server Component (app/channels/page.tsx) so
 * the list re-syncs from Supabase — the source of truth stays server-side,
 * this component holds no separate copy of the list in state.
 */
export function ChannelList({ initialChannels }: ChannelListProps) {
  const router = useRouter()
  const [channelUrl, setChannelUrl] = useState('')
  const [competitor, setCompetitor] = useState('')
  const urlInputRef = useRef<HTMLInputElement>(null)

  function errorMessage(error: unknown): string | null {
    return error instanceof ApiError ? error.message : error ? 'Something went wrong.' : null
  }

  const addMutation = useMutation({
    mutationFn: (vars: { channel_url: string; competitor: string }) =>
      apiFetch<{ status: string; data: ChannelRow }>('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      setChannelUrl('')
      setCompetitor('')
      router.refresh()
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (vars: { id: string; is_active: boolean }) =>
      apiFetch<{ status: string; data: ChannelRow }>(`/channels/${vars.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: vars.is_active }),
      }),
    onSuccess: () => router.refresh(),
  })

  const deleteMutation = useMutation({
    mutationFn: (vars: { id: string }) =>
      apiFetch<{ status: string }>(`/channels/${vars.id}`, { method: 'DELETE' }),
    onSuccess: () => router.refresh(),
  })

  function handleAdd(event: React.FormEvent) {
    event.preventDefault()
    const trimmedUrl = channelUrl.trim()
    const trimmedCompetitor = competitor.trim()
    if (!trimmedUrl || !trimmedCompetitor) return
    addMutation.mutate({ channel_url: trimmedUrl, competitor: trimmedCompetitor })
  }

  const mutationError =
    errorMessage(addMutation.error) ?? errorMessage(toggleMutation.error) ?? errorMessage(deleteMutation.error)

  return (
    <div className="mt-6 flex flex-col gap-6">
      {/* Add channel */}
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <label htmlFor="channel-url" className="text-sm font-medium text-foreground">
            YouTube channel URL
          </label>
          <input
            ref={urlInputRef}
            id="channel-url"
            type="url"
            required
            placeholder="https://www.youtube.com/@..."
            value={channelUrl}
            onChange={(event) => setChannelUrl(event.target.value)}
            className="h-10 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
          <label htmlFor="channel-competitor" className="text-sm font-medium text-foreground">
            Competitor name
          </label>
          <input
            id="channel-competitor"
            type="text"
            required
            placeholder="e.g. Acme Corp"
            value={competitor}
            onChange={(event) => setCompetitor(event.target.value)}
            className="h-10 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="submit"
          disabled={addMutation.isPending}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {addMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add Channel
        </button>
      </form>

      {mutationError ? <p className="text-sm text-destructive">{mutationError}</p> : null}

      {/* List — plain table when there's data, proper empty state otherwise. */}
      {initialChannels.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="No channels tracked yet"
          description="Add a YouTube channel above and the background scheduler will poll it automatically for new uploads."
          action={
            <button
              type="button"
              onClick={() => urlInputRef.current?.focus()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Plus className="size-4" />
              Add your first channel
            </button>
          }
        />
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded-xl border border-border text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5">Channel</th>
              <th className="px-4 py-2.5">Competitor</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Last checked</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {initialChannels.map((channel) => {
              const isToggling = toggleMutation.isPending && toggleMutation.variables?.id === channel.id
              const isDeleting = deleteMutation.isPending && deleteMutation.variables?.id === channel.id

              return (
                <tr key={channel.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <a
                      href={channel.channel_url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary hover:underline"
                    >
                      {channel.channel_name ?? channel.channel_url}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-foreground">{channel.competitor_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={channel.is_active ? 'font-medium text-success' : 'text-muted-foreground'}>
                      {channel.is_active ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {channel.last_checked_at ? new Date(channel.last_checked_at).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={isToggling}
                        onClick={() => toggleMutation.mutate({ id: channel.id, is_active: !channel.is_active })}
                        title={channel.is_active ? 'Pause polling' : 'Resume polling'}
                        className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                      >
                        {isToggling ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : channel.is_active ? (
                          <PowerOff className="size-4" />
                        ) : (
                          <Power className="size-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => {
                          if (window.confirm(`Stop tracking ${channel.channel_name ?? channel.channel_url}?`)) {
                            deleteMutation.mutate({ id: channel.id })
                          }
                        }}
                        title="Delete channel"
                        className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-destructive disabled:opacity-60"
                      >
                        {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

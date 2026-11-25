'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AnalysisJob } from '@/lib/api'

/**
 * Realtime-only (no HTTP polling) tracker for one `analysis_jobs` row.
 * the async job queue.
 *
 * Fetches the row's current state once when `jobId` changes — covers the
 * case where the job already progressed (or even completed) between the
 * enqueue response and this subscription starting — then keeps it live via
 * Supabase Realtime `postgres_changes` UPDATE events, scoped to that one row.
 *
 * `onUpdate` (optional) fires with every row state this hook observes
 * (initial fetch + every Realtime event), so callers can react to a
 * transition (e.g. "completed" -> fetch the finished report) from inside
 * that callback rather than a separate `useEffect` watching the returned
 * job — kept as a ref internally so passing a fresh inline function every
 * render does not tear down and recreate the subscription.
 *
 * Requires the `analysis_jobs` RLS SELECT policy and the table being added
 * to the `supabase_realtime` publication (see schema_jobs.sql) — without
 * either, this receives zero events and fails completely silently, so if
 * progress never advances past "Queued", check those first.
 */
export function useAnalysisJob(
  jobId: string | null,
  onUpdate?: (job: AnalysisJob) => void,
): AnalysisJob | null {
  const [job, setJob] = useState<AnalysisJob | null>(null)
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null)

  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  // Reset synchronously during render when the tracked job changes, instead
  // of in an effect — React's recommended pattern for resetting state in
  // response to a prop/argument change (avoids an extra render and keeps
  // every `setJob` call below inside an async callback, not the effect body).
  if (jobId !== trackedJobId) {
    setTrackedJobId(jobId)
    setJob(null)
  }

  useEffect(() => {
    if (!jobId) return

    let cancelled = false
    const supabase = createClient()

    function handleRow(row: AnalysisJob) {
      if (cancelled) return
      setJob(row)
      onUpdateRef.current?.(row)
    }

    supabase
      .from('analysis_jobs')
      .select('*')
      .eq('id', jobId)
      .single()
      .then(({ data }) => {
        if (data) handleRow(data as AnalysisJob)
      })

    const channel = supabase
      .channel(`analysis_job_${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'analysis_jobs', filter: `id=eq.${jobId}` },
        (payload) => handleRow(payload.new as AnalysisJob),
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [jobId])

  return job
}

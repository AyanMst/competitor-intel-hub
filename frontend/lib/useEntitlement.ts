'use client'

import { useEffect, useState } from 'react'
import { getBillingStatus, type EntitlementStatus } from '@/lib/api'

let cached: EntitlementStatus | null = null
let inflight: Promise<EntitlementStatus> | null = null

function loadBillingStatus(): Promise<EntitlementStatus> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = getBillingStatus()
      .then((data) => {
        cached = data
        return data
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function clearEntitlementCache() {
  cached = null
}

export function useEntitlement() {
  const [entitlement, setEntitlement] = useState<EntitlementStatus | null>(cached)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadBillingStatus()
      .then((data) => {
        if (!cancelled) setEntitlement(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load billing status.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return {
    entitlement,
    error,
    isLoading: entitlement === null && error === null,
  }
}

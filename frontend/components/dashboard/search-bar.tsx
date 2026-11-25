'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { searchReports, ApiError, type SearchResult } from '@/lib/api'
import { pillars, formatTimestamp } from './pillar-data'

interface SearchBarProps {
  /** Navigates to the matched report, optionally jumping to a pillar/timestamp. */
  onSelectResult: (reportId: string, pillar: SearchResult['pillar'], timestamp: number | null) => void
}

const DEBOUNCE_MS = 350

function pillarLabel(pillar: SearchResult['pillar']): string {
  return pillars.find((p) => p.key === pillar)?.label ?? pillar
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function SearchBar({ onSelectResult }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Debounced semantic search across all stored reports (not just the one
  // currently on screen) as the user types.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setError(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    const timer = setTimeout(() => {
      searchReports(trimmed)
        .then((data) => setResults(data))
        .catch((err) => {
          setError(err instanceof ApiError ? err.message : 'Search failed.')
          setResults([])
        })
        .finally(() => setIsLoading(false))
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query])

  // Close the dropdown on outside click.
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleSelect(result: SearchResult) {
    onSelectResult(result.report_id, result.pillar, result.claim_timestamp)
    setIsOpen(false)
    setQuery('')
    setResults([])
  }

  const showDropdown = isOpen && query.trim().length > 0

  return (
    <div ref={containerRef} className="relative ml-auto hidden max-w-xs flex-1 items-center md:flex">
      <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
      <input
        type="search"
        placeholder="Search all reports…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setIsOpen(true)}
        className="h-9 w-full rounded-lg border border-border bg-muted/50 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:bg-card focus:outline-none focus:ring-2 focus:ring-foreground/10"
      />

      {showDropdown ? (
        <div className="absolute left-0 top-11 z-30 max-h-96 w-[26rem] max-w-[90vw] overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-soft-lg">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Searching…
            </div>
          ) : error ? (
            <div className="p-3 text-sm text-destructive">{error}</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No matching claims found.</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(result)}
                    className="flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
                        {result.competitor_name ?? 'Uncategorized'}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          'bg-muted text-muted-foreground',
                        )}
                      >
                        {pillarLabel(result.pillar)}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {formatDate(result.report_created_at)}
                        {result.claim_timestamp !== null ? ` · ${formatTimestamp(result.claim_timestamp)}` : ''}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm text-foreground">{result.claim_text}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

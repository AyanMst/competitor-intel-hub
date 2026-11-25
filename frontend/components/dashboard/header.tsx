'use client'

import { useRef, useState } from 'react'
import { Bell, Clapperboard, Link2, Loader2 } from 'lucide-react'
import { SearchBar } from './search-bar'
import type { SearchResult } from '@/lib/api'

interface HeaderProps {
  fileName: string | null
  isLoading: boolean
  analysisLocked?: boolean
  onFileSelected: (file: File, competitor: string) => void
  onUrlSubmitted: (url: string, competitor: string) => void
  onSearchResultSelected: (reportId: string, pillar: SearchResult['pillar'], timestamp: number | null) => void
}

export function Header({ fileName, isLoading, analysisLocked = false, onFileSelected, onUrlSubmitted, onSearchResultSelected }: HeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [competitor, setCompetitor] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const trimmedCompetitor = competitor.trim()

  function handleButtonClick() {
    if (!trimmedCompetitor) return
    fileInputRef.current?.click()
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file && trimmedCompetitor) {
      onFileSelected(file, trimmedCompetitor)
    }
    // Reset so selecting the same file again still fires onChange.
    event.target.value = ''
  }

  function handleUrlSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedUrl = youtubeUrl.trim()
    if (!trimmedUrl || !trimmedCompetitor) return
    onUrlSubmitted(trimmedUrl, trimmedCompetitor)
    setYoutubeUrl('')
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-5 backdrop-blur-md lg:px-8">
      {/* Breadcrumb */}
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="hidden text-muted-foreground sm:inline">Reports</span>
        <span className="hidden text-muted-foreground/40 sm:inline">/</span>
        <span className="truncate font-semibold text-foreground">{fileName ?? 'New Analysis'}</span>
      </div>

      {/* Semantic search: queries claim embeddings across ALL saved
          reports, not just the one currently on screen. */}
      <SearchBar onSelectResult={onSearchResultSelected} />

      {/* Competitor name: required before a video can be uploaded, so every
          saved report links to a competitor for change detection. */}
      <input
        type="text"
        placeholder="Competitor name"
        value={competitor}
        onChange={(event) => setCompetitor(event.target.value)}
        className="h-9 w-36 shrink-0 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:bg-card focus:outline-none focus:ring-2 focus:ring-foreground/10 sm:w-44"
      />

      <button
        type="button"
        className="relative flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground md:ml-0"
        aria-label="Notifications"
      >
        <Bell className="size-[18px]" />
        <span className="absolute right-2 top-2 size-2 rounded-full bg-destructive ring-2 ring-card" />
      </button>

      {/* YouTube URL flow: alternative to mp4 upload, same competitor gate, hits POST /analyze */}
      <form onSubmit={handleUrlSubmit} className="hidden items-center gap-2 md:flex">
        <input
          type="url"
          placeholder="YouTube URL"
          value={youtubeUrl}
          onChange={(event) => setYoutubeUrl(event.target.value)}
          className="h-9 w-40 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:bg-card focus:outline-none focus:ring-2 focus:ring-foreground/10 lg:w-52"
        />
        <button
          type="submit"
          disabled={isLoading || analysisLocked || !trimmedCompetitor || !youtubeUrl.trim()}
          title={
            analysisLocked
              ? 'Upgrade to generate new battlecards'
              : !trimmedCompetitor
                ? 'Enter a competitor name first'
                : undefined
          }
          className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
        >
          <Link2 className="size-4" />
          <span className="hidden lg:inline">Analyze URL</span>
        </button>
      </form>

      {/* Primary CTA: hidden file input triggered by this button drives the mp4 upload flow */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,video/mp4"
        className="hidden"
        onChange={handleFileChange}
      />
      <button
        type="button"
        onClick={handleButtonClick}
        disabled={isLoading || analysisLocked || !trimmedCompetitor}
        title={
          analysisLocked
            ? 'Upgrade to generate new battlecards'
            : !trimmedCompetitor
              ? 'Enter a competitor name first'
              : undefined
        }
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-brand transition-all hover:-translate-y-px hover:bg-primary/90 active:translate-y-0 disabled:pointer-events-none disabled:opacity-60 sm:px-4"
      >
        {isLoading ? <Loader2 className="size-[18px] animate-spin" /> : <Clapperboard className="size-[18px]" />}
        <span className="hidden sm:inline">{isLoading ? 'Analyzing…' : 'Upload & Analyze Video'}</span>
        <span className="sm:hidden">{isLoading ? '…' : 'Analyze'}</span>
      </button>
    </header>
  )
}

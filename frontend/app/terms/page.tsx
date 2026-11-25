import type { Metadata } from 'next'
import { LegalPlaceholder } from '@/components/legal/legal-placeholder'

export const metadata: Metadata = {
  title: 'Terms of Service (placeholder)',
  description: 'Demo placeholder — not a real legal document.',
}

export default function TermsPage() {
  return <LegalPlaceholder title="Terms of Service" />
}

import type { Metadata } from 'next'
import { LegalPlaceholder } from '@/components/legal/legal-placeholder'

export const metadata: Metadata = {
  title: 'Privacy Policy (placeholder)',
  description: 'Demo placeholder — not a real legal document.',
}

export default function PrivacyPage() {
  return <LegalPlaceholder title="Privacy Policy" />
}

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AITrace - PoC AI Provenance',
  description: 'Blockchain-based provenance tracking for AI models',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  )
}

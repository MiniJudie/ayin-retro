import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Providers } from '@/components/Providers'
import { Footer } from '@/components/Footer'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Ayin Retro — Pools',
  description:
    'Ayin Retro is a backup interface for Ayin (DEX on Alephium). Pools & swap (V1 AMM). Provided as is.',
  openGraph: {
    title: 'Ayin Retro — Pools & Swap',
    description:
      'Backup interface for Ayin (DEX on Alephium). Pools & swap (V1 AMM). Provided as is.',
    type: 'website',
    siteName: 'Ayin Retro',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}>
        <Providers>
          <div className="flex min-h-screen flex-col">
            {children}
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  )
}

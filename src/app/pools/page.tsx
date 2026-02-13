'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PoolsRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/')
  }, [router])
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <p className="text-sm text-[var(--muted)]">Redirecting to pools…</p>
    </div>
  )
}

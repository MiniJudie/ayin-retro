'use client'

import Link from 'next/link'
import { AlephiumConnectButton, useWallet } from '@alephium/web3-react'
import { useWalletBalance } from '@/contexts/WalletBalanceContext'

export function Header() {
  const { account } = useWallet()
  const { refreshBalances, isRefreshing } = useWalletBalance()

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--card-border)] bg-[var(--background)]/80 backdrop-blur-md">
      <div className="border-b border-[var(--card-border)] bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-200/90">
        This interface is provided as is. We are not responsible for misuse or loss of funds. Use at your own risk.
      </div>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-xl font-semibold text-white">
          <span className="rounded-lg bg-gradient-to-r from-blue-500 to-cyan-400 px-2 py-0.5 font-bold">
            Ayin
          </span>
          <span className="text-[var(--muted)]">Retro</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-sm font-medium text-white hover:text-[var(--muted)]"
          >
            Pools
          </Link>
          <Link
            href="/swap"
            className="text-sm font-medium text-white hover:text-[var(--muted)]"
          >
            Swap
          </Link>
          <Link
            href="/staking"
            className="text-sm font-medium text-white hover:text-[var(--muted)]"
          >
            Staking
          </Link>
          <Link
            href="/about"
            className="text-sm font-medium text-white hover:text-[var(--muted)]"
          >
            About
          </Link>
          {account?.address && (
            <button
              type="button"
              onClick={() => refreshBalances()}
              disabled={isRefreshing}
              title="Refresh wallet balance"
              className="rounded-lg border border-[var(--card-border)] p-2 text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={isRefreshing ? 'animate-spin' : ''}
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
            </button>
          )}
          <AlephiumConnectButton />
        </div>
      </div>
    </header>
  )
}

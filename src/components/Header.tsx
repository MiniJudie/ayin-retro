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
        This interface is provided as is. Community driven not related to ayin team. We are not responsible for misuse or loss of funds. Use at your own risk.
      </div>
      <div className="mx-auto max-w-6xl px-4 py-4 md:flex md:h-16 md:flex-row md:items-center md:justify-between md:py-0">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-4">
          <div className="flex items-center justify-between md:justify-start">
            <Link href="/" className="flex items-center gap-2 text-xl font-semibold text-white">
              <span className="rounded-lg bg-gradient-to-r from-blue-500 to-cyan-400 px-2 py-0.5 font-bold">
                Ayin
              </span>
              <span className="text-[var(--muted)]">Retro</span>
            </Link>
            <div className="flex items-center gap-2 md:hidden">
              <AlephiumConnectButton />
            </div>
          </div>
          <div className="flex w-full items-center gap-2 md:w-auto md:contents">
            <nav className="flex flex-1 gap-1 md:flex-initial md:gap-4">
              <Link
                href="/"
                className="flex-1 py-2 text-center text-sm font-medium text-white hover:text-[var(--muted)] md:flex-none"
              >
                Pools
              </Link>
              <Link
                href="/swap"
                className="flex-1 py-2 text-center text-sm font-medium text-white hover:text-[var(--muted)] md:flex-none"
              >
                Swap
              </Link>
              <Link
                href="/staking"
                className="flex-1 py-2 text-center text-sm font-medium text-white hover:text-[var(--muted)] md:flex-none"
              >
                Staking
              </Link>
              <Link
                href="/about"
                className="flex-1 py-2 text-center text-sm font-medium text-white hover:text-[var(--muted)] md:flex-none"
              >
                About
              </Link>
            </nav>
            {account?.address && (
              <button
                type="button"
                onClick={() => refreshBalances()}
                disabled={isRefreshing}
                title="Refresh wallet balance"
                className="shrink-0 rounded-lg border border-[var(--card-border)] p-2 text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50 md:hidden"
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
          </div>
        </div>
        <div className="hidden items-center gap-4 md:flex">
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

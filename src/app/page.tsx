'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/Header'
import type { PoolInfo } from '@/lib/types'
import { EXPLORER_URL, NODE_URL } from '@/lib/config'
import { web3 } from '@alephium/web3'
import { getPoolState } from '@/lib/poolState'
import { useWalletBalance } from '@/contexts/WalletBalanceContext'
import { getLpBalance, formatLpAmount } from '@/lib/poolUtils'

const ONE_ALPH = BigInt('1000000000000000000') // 1 ALPH = 10^18

/** Human-readable reserve: K/M/B for large, compact decimals for small, no scientific notation. */
function formatReserve(value: string, decimals: number): string {
  const n = BigInt(value)
  if (n === BigInt(0)) return '0'
  const s = n.toString()
  if (s.length <= decimals) {
    const frac = s.padStart(decimals, '0').slice(0, decimals).replace(/0+$/, '')
    if (frac.length === 0) return '0'
    const trimmed = frac.slice(0, 6).replace(/0+$/, '')
    return trimmed ? `0.${trimmed}` : '< 0.000001'
  }
  const int = s.slice(0, -decimals)
  const frac = s.slice(-decimals).replace(/0+$/, '')
  const fullNum = frac ? parseFloat(`${int}.${frac}`) : parseFloat(int)
  if (fullNum >= 1e12) return `${(fullNum / 1e12).toFixed(2)}T`
  if (fullNum >= 1e9) return `${(fullNum / 1e9).toFixed(2)}B`
  if (fullNum >= 1e6) return `${(fullNum / 1e6).toFixed(2)}M`
  if (fullNum >= 1e3) return `${(fullNum / 1e3).toFixed(2)}K`
  if (fullNum < 0.000001) return '< 0.000001'
  if (fullNum < 1) return fullNum.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return fullNum.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

export default function PoolsPage() {
  const { balances, refreshBalances } = useWalletBalance()
  const [pools, setPools] = useState<PoolInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [reservesLoading, setReservesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(99)

  useEffect(() => {
    web3.setCurrentNodeProvider(NODE_URL)
  }, [])

  /** Fast: fetch list only (no chain calls). Use on mount / when coming back. */
  const loadPoolList = useCallback(() => {
    fetch('/api/pools')
      .then((r) => r.json())
      .then((list: PoolInfo[]) => {
        setPools(list)
        setError(null)
        setVisibleCount(99)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load pools')
        setPools([])
      })
      .finally(() => {
        setLoading(false)
        refreshBalances?.()
      })
  }, [refreshBalances])

  /** Full refresh: list + live reserves from chain. Use when user clicks Refresh. */
  const handleRefreshPools = useCallback(() => {
    setReservesLoading(true)
    fetch('/api/pools')
      .then((r) => r.json())
      .then((list: PoolInfo[]) => {
        setPools(list)
        setError(null)
        return list
      })
      .then((list) =>
        Promise.all(
          list.map(async (pool) => {
            const state = await getPoolState(pool.address, pool.poolType)
            if (!state) return pool
            return { ...pool, reserve0: state.reserve0, reserve1: state.reserve1 }
          })
        )
      )
      .then((updated) => {
        setPools(updated)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to refresh pools')
        setPools([])
      })
      .finally(() => {
        setReservesLoading(false)
        refreshBalances?.()
      })
  }, [refreshBalances])

  // On mount (initial load and when coming back via back link): fast list + wallet refresh only
  useEffect(() => {
    loadPoolList()
  }, [loadPoolList])

  const minOneAlphPools = pools.filter(
    (p) => BigInt(p.reserve0) >= ONE_ALPH
  )
  const sortedPools = useMemo(() => {
    return [...minOneAlphPools].sort((a, b) => {
      const lpA = balances ? (getLpBalance(balances, a.address) ?? BigInt(0)) : BigInt(0)
      const lpB = balances ? (getLpBalance(balances, b.address) ?? BigInt(0)) : BigInt(0)
      const hasA = lpA > BigInt(0)
      const hasB = lpB > BigInt(0)
      if (hasA && !hasB) return -1
      if (!hasA && hasB) return 1
      const r0a = BigInt(a.reserve0)
      const r0b = BigInt(b.reserve0)
      return r0b > r0a ? 1 : r0b < r0a ? -1 : 0
    })
  }, [minOneAlphPools, balances])

  const displayedPools = useMemo(
    () => sortedPools.slice(0, visibleCount),
    [sortedPools, visibleCount]
  )
  const hasMorePools = sortedPools.length > visibleCount

  const gridCols = 'minmax(36px,0.12fr) minmax(140px,1fr) minmax(48px,0.35fr) minmax(100px,0.8fr) minmax(100px,0.8fr) minmax(100px,1fr) minmax(100px,1fr) minmax(100px,0.8fr) minmax(160px,auto)'

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Header />
      <main className="pt-28 pb-12 px-4">
        <div className="mx-auto w-full max-w-[1600px]">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white">All Pools</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Ayin Retro liquidity pools. Reserves are read from chain. Click a pool to open swap with that pair.
            </p>
          </div>

          {loading && (
            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-12 text-center text-[var(--muted)]">
              Loading pools…
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-center text-red-400">
              {error}
            </div>
          )}

          {!loading && !error && sortedPools.length === 0 && (
            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-12 text-center text-[var(--muted)]">
              No pools found. Ensure <code className="rounded bg-[var(--input-bg)] px-1 py-0.5 text-xs">data/pool.json</code> exists (run <code className="rounded bg-[var(--input-bg)] px-1 py-0.5 text-xs">node scripts/merge-pools.js</code> to generate from ayin.pool.json + mobula.pair.2.json).
            </div>
          )}

          {!loading && sortedPools.length > 0 && (
            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)]">
              <div className="flex items-center justify-end border-b border-[var(--card-border)] px-4 py-2">
                <button
                  type="button"
                  onClick={handleRefreshPools}
                  disabled={reservesLoading}
                  title="Refresh pools and reserves"
                  className="flex items-center gap-2 rounded-lg border border-[var(--card-border)] px-3 py-2 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={reservesLoading ? 'animate-spin' : ''}
                  >
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                    <path d="M16 21h5v-5" />
                  </svg>
                  {reservesLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {/* Desktop: grid table (≥1280px) */}
              <div className="hidden xl:block overflow-hidden">
                <div
                  className="grid w-full gap-0 border-b border-[var(--card-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div className="px-2 py-4 text-right">#</div>
                  <div className="px-4 py-4">Pool</div>
                  <div className="px-4 py-4 text-center">Version</div>
                  <div className="px-4 py-4 text-right">Reserve 0</div>
                  <div className="px-4 py-4">Token 0</div>
                  <div className="px-4 py-4 text-right">Reserve 1</div>
                  <div className="px-4 py-4">Token 1</div>
                  <div className="px-4 py-4 text-right">LP balance</div>
                  <div className="px-4 py-4">Actions</div>
                </div>
                {displayedPools.map((pool, index) => (
                <div
                  key={pool.address}
                  className="grid w-full gap-0 border-b border-[var(--card-border)] last:border-b-0 transition-colors hover:bg-white/[0.02]"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div className="px-2 py-4 text-right font-mono text-sm text-[var(--muted)]">
                    {index + 1}
                  </div>
                  <div className="flex items-center gap-2 px-4 py-4">
                    {pool.token0.logoURI && (
                      <img
                        src={pool.token0.logoURI}
                        alt=""
                        className="h-6 w-6 rounded-full"
                      />
                    )}
                    {pool.token1.logoURI && (
                      <img
                        src={pool.token1.logoURI}
                        alt=""
                        className="-ml-2 h-6 w-6 rounded-full ring-2 ring-[var(--card)]"
                      />
                    )}
                    <span className="font-medium text-white">
                      {pool.token0.symbol} / {pool.token1.symbol}
                    </span>
                  </div>
                  <div className="px-4 py-4 text-center">
                    <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-[var(--muted)]" title={pool.poolType === 'V2' ? 'AyinTokenV2' : 'AyinToken'}>
                      {pool.poolType ?? 'V1'}
                    </span>
                  </div>
                  <div className="px-4 py-4 text-right font-mono text-sm text-[var(--muted)]">
                    {reservesLoading ? '…' : formatReserve(pool.reserve0, pool.token0.decimals)}
                  </div>
                  <div className="px-4 py-4">
                    <span className="text-white">{pool.token0.symbol}</span>
                    <span className="ml-1 text-xs text-[var(--muted)]">
                      ({pool.token0.name})
                    </span>
                  </div>
                  <div className="px-4 py-4 text-right font-mono text-sm text-[var(--muted)]">
                    {reservesLoading ? '…' : formatReserve(pool.reserve1, pool.token1.decimals)}
                  </div>
                  <div className="px-4 py-4">
                    <span className="text-white">{pool.token1.symbol}</span>
                    <span className="ml-1 text-xs text-[var(--muted)]">
                      ({pool.token1.name})
                    </span>
                  </div>
                  <div className="px-4 py-4 text-right font-mono text-sm">
                    {balances
                      ? (() => {
                          const lp = getLpBalance(balances, pool.address)
                          const hasPosition = lp !== null && lp > BigInt(0)
                          const str = lp !== null ? formatLpAmount(lp) : '—'
                          return hasPosition ? (
                            <span className="font-semibold text-[var(--accent)]">{str}</span>
                          ) : (
                            <span className="text-[var(--muted)]">{str}</span>
                          )
                        })()
                      : <span className="text-[var(--muted)]">—</span>}
                  </div>
                  <div className="flex items-center gap-2 px-4 py-4">
                    <Link
                      href={`/pools/${pool.address}`}
                      className="inline-flex items-center justify-center rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
                    >
                      Manage
                    </Link>
                    <Link
                      href={`/swap?tokenIn=${pool.token0.id}&tokenOut=${pool.token1.id}`}
                      className="inline-flex items-center justify-center rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/5"
                    >
                      Swap
                    </Link>
                    <a
                      href={`${EXPLORER_URL}/addresses/${pool.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-white"
                    >
                      Contract
                    </a>
                  </div>
                </div>
              ))}
                {hasMorePools && (
                  <div className="flex justify-center border-t border-[var(--card-border)] px-4 py-4">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((c) => Math.min(c + 99, sortedPools.length))}
                      className="rounded-xl border border-[var(--card-border)] px-6 py-2.5 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-white"
                    >
                      Load more
                    </button>
                  </div>
                )}
              </div>

              {/* Mobile/tablet: stacked cards (<1280px) */}
              <div className="xl:hidden divide-y divide-[var(--card-border)]">
                {displayedPools.map((pool, index) => {
                  const lp = balances ? getLpBalance(balances, pool.address) : null
                  const hasPosition = lp !== null && lp > BigInt(0)
                  const lpStr = lp !== null ? formatLpAmount(lp) : '—'
                  return (
                    <div
                      key={pool.address}
                      className="p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-[var(--muted)]">{index + 1}</span>
                        <div className="flex items-center gap-2 min-w-0 flex-1 justify-start">
                          {pool.token0.logoURI && (
                            <img src={pool.token0.logoURI} alt="" className="h-6 w-6 rounded-full shrink-0" />
                          )}
                          {pool.token1.logoURI && (
                            <img src={pool.token1.logoURI} alt="" className="-ml-2 h-6 w-6 rounded-full ring-2 ring-[var(--card)] shrink-0" />
                          )}
                          <span className="font-medium text-white truncate">
                            {pool.token0.symbol} / {pool.token1.symbol}
                          </span>
                        </div>
                        <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-[var(--muted)] shrink-0" title={pool.poolType === 'V2' ? 'AyinTokenV2' : 'AyinToken'}>
                          {pool.poolType ?? 'V1'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="text-[var(--muted)]">Reserve 0</span>
                          <span className="font-mono text-white truncate">{reservesLoading ? '…' : formatReserve(pool.reserve0, pool.token0.decimals)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-[var(--muted)]">Token 0</span>
                          <span className="text-white truncate">{pool.token0.symbol}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-[var(--muted)]">Reserve 1</span>
                          <span className="font-mono text-white truncate">{reservesLoading ? '…' : formatReserve(pool.reserve1, pool.token1.decimals)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-[var(--muted)]">Token 1</span>
                          <span className="text-white truncate">{pool.token1.symbol}</span>
                        </div>
                        <div className="col-span-2 flex justify-between gap-2">
                          <span className="text-[var(--muted)]">LP balance</span>
                          <span className={`font-mono ${hasPosition ? 'font-semibold text-[var(--accent)]' : 'text-[var(--muted)]'}`}>{lpStr}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Link
                          href={`/pools/${pool.address}`}
                          className="flex-1 min-w-0 inline-flex items-center justify-center rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
                        >
                          Manage
                        </Link>
                        <Link
                          href={`/swap?tokenIn=${pool.token0.id}&tokenOut=${pool.token1.id}`}
                          className="flex-1 min-w-0 inline-flex items-center justify-center rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/5"
                        >
                          Swap
                        </Link>
                        <a
                          href={`${EXPLORER_URL}/addresses/${pool.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 min-w-0 inline-flex items-center justify-center rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-white"
                        >
                          Contract
                        </a>
                      </div>
                    </div>
                  )
                })}
                {hasMorePools && (
                  <div className="flex justify-center px-4 py-4">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((c) => Math.min(c + 99, sortedPools.length))}
                      className="rounded-xl border border-[var(--card-border)] px-6 py-2.5 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-white"
                    >
                      Load more
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="mt-6 text-center text-xs text-[var(--muted)]">
            {sortedPools.length} pool{sortedPools.length !== 1 ? 's' : ''} • Ayin Retro
          </p>
        </div>
      </main>
    </div>
  )
}

'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useWallet } from '@alephium/web3-react'
import { web3 } from '@alephium/web3'
import { NODE_URL } from '@/lib/config'

export interface WalletBalances {
  alph: bigint
  tokens: Map<string, bigint>
}

const WalletBalanceContext = createContext<{
  balances: WalletBalances | null
  refreshBalances: () => Promise<void>
  isRefreshing: boolean
} | null>(null)

export function WalletBalanceProvider({ children }: { children: React.ReactNode }) {
  const { account } = useWallet()
  const [balances, setBalances] = useState<WalletBalances | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const fetchBalances = useCallback(async () => {
    if (!account?.address) {
      setBalances(null)
      return
    }
    try {
      const b = await web3.getCurrentNodeProvider().addresses.getAddressesAddressBalance(account.address)
      const tokensMap = new Map<string, bigint>()
      for (const t of b.tokenBalances ?? []) {
        const raw = (t.id ?? '').trim().toLowerCase()
        if (!raw) continue
        const id = raw.startsWith('0x') ? raw.slice(2) : raw
        tokensMap.set(id, BigInt(t.amount))
        if (raw !== id) tokensMap.set(raw, BigInt(t.amount))
      }
      setBalances({ alph: BigInt(b.balance), tokens: tokensMap })
    } catch {
      setBalances(null)
    }
  }, [account?.address])

  useEffect(() => {
    web3.setCurrentNodeProvider(NODE_URL)
  }, [])

  useEffect(() => {
    if (!account?.address) {
      setBalances(null)
      return
    }
    let cancelled = false
    fetchBalances().then(() => {
      if (cancelled) return
    })
    return () => {
      cancelled = true
    }
  }, [account?.address, fetchBalances])

  const refreshBalances = useCallback(async () => {
    if (!account?.address) return
    setIsRefreshing(true)
    try {
      await fetchBalances()
    } finally {
      setIsRefreshing(false)
    }
  }, [account?.address, fetchBalances])

  return (
    <WalletBalanceContext.Provider value={{ balances, refreshBalances, isRefreshing }}>
      {children}
    </WalletBalanceContext.Provider>
  )
}

export function useWalletBalance() {
  const ctx = useContext(WalletBalanceContext)
  if (!ctx) throw new Error('useWalletBalance must be used within WalletBalanceProvider')
  return ctx
}

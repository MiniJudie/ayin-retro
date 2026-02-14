'use client'

import { AlephiumWalletProvider } from '@alephium/web3-react'
import { WalletBalanceProvider } from '@/contexts/WalletBalanceContext'
import { MatomoUserIdSync } from '@/components/MatomoUserIdSync'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AlephiumWalletProvider network="mainnet" theme="midnight">
      <MatomoUserIdSync />
      <WalletBalanceProvider>{children}</WalletBalanceProvider>
    </AlephiumWalletProvider>
  )
}

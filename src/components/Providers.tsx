'use client'

import { AlephiumWalletProvider } from '@alephium/web3-react'
import { WalletBalanceProvider } from '@/contexts/WalletBalanceContext'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AlephiumWalletProvider network="mainnet" theme="midnight">
      <WalletBalanceProvider>{children}</WalletBalanceProvider>
    </AlephiumWalletProvider>
  )
}

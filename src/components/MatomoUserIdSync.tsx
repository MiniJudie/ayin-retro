'use client'

import { useEffect, useRef } from 'react'
import { useWallet } from '@alephium/web3-react'
import { push } from '@socialgouv/matomo-next'

export function MatomoUserIdSync() {
  const { account } = useWallet()
  const prevAddressRef = useRef<string | null>(null)

  useEffect(() => {
    const address = account?.address ?? null
    if (address === prevAddressRef.current) return
    prevAddressRef.current = address

    if (address) {
      push(['setUserId', address])
    } else {
      push(['resetUserId'])
    }
  }, [account?.address])

  return null
}

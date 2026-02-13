import { contractIdFromAddress, isContractAddress, binToHex } from '@alephium/web3'
import type { WalletBalances } from '@/contexts/WalletBalanceContext'

const LP_DECIMALS = 18

/** Returns the LP token id (32-byte hex) for use in transactions. Pass pool address or contract id. */
export function getLpTokenIdForTx(poolAddressOrId: string): string {
  const s = poolAddressOrId.trim()
  if (/^0x[0-9a-f]{64}$/i.test(s)) return s.toLowerCase().startsWith('0x') ? s.slice(2).toLowerCase() : s.toLowerCase()
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase()
  const cid = binToHex(contractIdFromAddress(s)).toLowerCase()
  return cid
}

/** Keys to try when looking up LP token balance; pool.address may be contract address (base58) or contract id (hex). */
export function poolTokenIdForBalance(poolAddress: string): string[] {
  const keys: string[] = []
  const lower = poolAddress.trim().toLowerCase()
  keys.push(lower)
  if (lower.startsWith('0x')) keys.push(lower.slice(2))
  else if (/^[0-9a-f]{64}$/.test(lower)) keys.push(lower)
  try {
    if (isContractAddress(poolAddress)) {
      const cid = binToHex(contractIdFromAddress(poolAddress)).toLowerCase()
      keys.push(cid)
      keys.push('0x' + cid)
    }
  } catch {
    // not a contract address (e.g. already hex id)
  }
  return keys
}

export function getLpBalance(balances: WalletBalances | null, poolAddress: string): bigint | null {
  if (!balances) return null
  for (const key of poolTokenIdForBalance(poolAddress)) {
    const amount = balances.tokens.get(key)
    if (amount !== undefined) return amount
  }
  return BigInt(0)
}

export function formatLpAmount(amount: bigint): string {
  const s = amount.toString()
  if (s.length <= LP_DECIMALS) return '0.' + s.padStart(LP_DECIMALS, '0').slice(0, LP_DECIMALS)
  const int = s.slice(0, -LP_DECIMALS)
  const frac = s.slice(-LP_DECIMALS).replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

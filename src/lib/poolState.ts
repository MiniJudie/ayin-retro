import { web3 } from '@alephium/web3'
import { TokenPair } from './TokenPair'

export interface PoolStateResult {
  reserve0: string
  reserve1: string
  totalSupply?: string
}

/** TokenPair (V1) mutable field indices: reserve0, reserve1, blockTimeStampLast, price0CumulativeLast, price1CumulativeLast, totalSupply, kLast, feeCollectorId */
const MUT_IDX_RESERVE0 = 0
const MUT_IDX_RESERVE1 = 1
const MUT_IDX_TOTAL_SUPPLY = 5

function parseMutFieldAsU256(mutFields: unknown[], index: number): string | undefined {
  const field = mutFields[index]
  if (field === null || field === undefined) return undefined
  const v = (field as { value?: unknown }).value
  if (typeof v === 'string') return v
  return undefined
}

/**
 * Fetches reserve0, reserve1 (and totalSupply) from a pair contract at the given address.
 * - If the contract's codeHash matches TokenPair (V1), uses TokenPair to decode state.
 * - Otherwise (e.g. V2 pair with different codeHash), reads reserve0/reserve1/totalSupply
 *   from raw mutFields by index (same layout as TokenPair: reserve0=0, reserve1=1, totalSupply=5).
 * Requires setCurrentNodeProvider to be called first (e.g. in the page that uses this).
 */
export async function getPoolState(
  poolAddress: string,
  _poolType?: string
): Promise<PoolStateResult | null> {
  const provider = web3.getCurrentNodeProvider()
  if (!provider) return null

  try {
    const rawState = await provider.contracts.getContractsAddressState(poolAddress)
    const codeHash = (rawState as { codeHash?: string }).codeHash
    const tokenPairCodeHash = (TokenPair.contract as { codeHash: string }).codeHash

    if (codeHash === tokenPairCodeHash) {
      const instance = TokenPair.at(poolAddress)
      const state = await instance.fetchState()
      const fields = state.fields

      console.log('fields', fields); 
      return {
        reserve0: fields.reserve0.toString(),
        reserve1: fields.reserve1.toString(),
        totalSupply: fields.totalSupply?.toString(),
      }
    }

    const mutFields: unknown[] = Array.isArray(rawState.mutFields) ? rawState.mutFields : []
    const reserve0 = parseMutFieldAsU256(mutFields, MUT_IDX_RESERVE0)
    const reserve1 = parseMutFieldAsU256(mutFields, MUT_IDX_RESERVE1)
    const totalSupply = parseMutFieldAsU256(mutFields, MUT_IDX_TOTAL_SUPPLY)
    if (reserve0 === undefined || reserve1 === undefined) return null

    return {
      reserve0,
      reserve1,
      ...(totalSupply !== undefined && { totalSupply }),
    }
  } catch {
    return null
  }
}

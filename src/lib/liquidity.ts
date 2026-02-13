import { SignerProvider, DUST_AMOUNT, ALPH_TOKEN_ID } from '@alephium/web3'
import { signExecuteMethod } from '@alephium/web3'
import { TokenPair } from './contracts'
import { getLpTokenIdForTx } from './poolUtils'

export interface PairState {
  token0Id: string
  token1Id: string
  reserve0: bigint
  reserve1: bigint
}

/**
 * Estimate LP tokens minted for given amounts (Uniswap v2 style).
 * Actual amount is computed by the contract; this is for preview only.
 */
export function getLiquidityMinted(
  amount0: bigint,
  amount1: bigint,
  reserve0: bigint,
  reserve1: bigint,
  totalSupply: bigint
): bigint {
  if (reserve0 === BigInt(0) || reserve1 === BigInt(0)) return BigInt(0)
  const liquidity0 = (amount0 * totalSupply) / reserve0
  const liquidity1 = (amount1 * totalSupply) / reserve1
  return liquidity0 < liquidity1 ? liquidity0 : liquidity1
}

/**
 * Estimate token amounts received when burning liquidity.
 */
export function getAmountsForLiquidity(
  liquidity: bigint,
  reserve0: bigint,
  reserve1: bigint,
  totalSupply: bigint
): [bigint, bigint] {
  if (totalSupply === BigInt(0)) return [BigInt(0), BigInt(0)]
  const amount0 = (liquidity * reserve0) / totalSupply
  const amount1 = (liquidity * reserve1) / totalSupply
  return [amount0, amount1]
}

/**
 * Add liquidity: deposit amount0 of token0 and amount1 of token1, receive LP tokens (pool contract id).
 */
export async function executeAddLiquidity(
  pairAddress: string,
  signer: SignerProvider,
  sender: string,
  token0Id: string,
  token1Id: string,
  amount0: bigint,
  amount1: bigint
): Promise<{ txId: string }> {
  const instance = TokenPair.at(pairAddress)
  const isToken0Alph = token0Id === ALPH_TOKEN_ID
  const isToken1Alph = token1Id === ALPH_TOKEN_ID

  let attoAlphAmount = DUST_AMOUNT * BigInt(2)
  if (isToken0Alph) attoAlphAmount += amount0
  if (isToken1Alph) attoAlphAmount += amount1

  const tokens: { id: string; amount: bigint }[] = []
  if (!isToken0Alph) tokens.push({ id: token0Id, amount: amount0 })
  if (!isToken1Alph) tokens.push({ id: token1Id, amount: amount1 })

  const result = await signExecuteMethod(TokenPair, instance, 'mint', {
    signer,
    args: {
      sender: sender as `@${string}`,
      amount0,
      amount1,
    },
    attoAlphAmount,
    tokens: tokens.length > 0 ? tokens : undefined,
  })

  return { txId: result.txId }
}

/**
 * Remove liquidity: send LP tokens (token id = pool contract id) and receive token0 and token1.
 * Uses contract id (32-byte hex) for the LP token so the tx builder matches the user's balance.
 */
export async function executeRemoveLiquidity(
  pairAddress: string,
  signer: SignerProvider,
  sender: string,
  liquidity: bigint
): Promise<{ txId: string }> {
  const instance = TokenPair.at(pairAddress)
  const lpTokenId = getLpTokenIdForTx(pairAddress)

  const result = await signExecuteMethod(TokenPair, instance, 'burn', {
    signer,
    args: {
      sender: sender as `@${string}`,
      liquidity,
    },
    attoAlphAmount: DUST_AMOUNT * BigInt(2),
    tokens: [{ id: lpTokenId, amount: liquidity }],
  })

  return { txId: result.txId }
}

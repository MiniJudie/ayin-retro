import { SignerProvider, DUST_AMOUNT, ONE_ALPH, ALPH_TOKEN_ID } from '@alephium/web3'
import { signExecuteMethod } from '@alephium/web3'
import { TokenPair } from './contracts'

export interface PairState {
  token0Id: string
  token1Id: string
  reserve0: bigint
  reserve1: bigint
}

/** Amount out from exact amount in (0.99% fee). Same formula as Ayin V1. */
export function getAmountOut(
  pair: PairState,
  tokenInId: string,
  amountIn: bigint
): bigint {
  const [reserveIn, reserveOut] =
    tokenInId === pair.token0Id
      ? [pair.reserve0, pair.reserve1]
      : [pair.reserve1, pair.reserve0]
  const amountInExcludeFee = BigInt(990) * amountIn
  const numerator = amountInExcludeFee * reserveOut
  const denominator = amountInExcludeFee + BigInt(1000) * reserveIn
  return numerator / denominator
}

/** Amount in for exact amount out. Same formula as Ayin V1. */
export function getAmountIn(
  pair: PairState,
  tokenOutId: string,
  amountOut: bigint
): bigint {
  const [reserveIn, reserveOut] =
    tokenOutId === pair.token0Id
      ? [pair.reserve1, pair.reserve0]
      : [pair.reserve0, pair.reserve1]
  if (amountOut >= reserveOut) {
    throw new Error('Amount out must be less than reserve')
  }
  const numerator = reserveIn * amountOut * BigInt(1000)
  const denominator = (reserveOut - amountOut) * BigInt(997)
  return numerator / denominator + BigInt(1)
}

/**
 * Execute swap directly on the TokenPair contract (no Router).
 * Uses TokenPair.swap(sender, to, amount0In, amount1In, amount0Out, amount1Out).
 */
export async function executeSwap(
  pairAddress: string,
  pair: PairState,
  signer: SignerProvider,
  sender: string,
  to: string,
  tokenInId: string,
  amountIn: bigint,
  amountOut: bigint
): Promise<{ txId: string }> {
  const isToken0In = tokenInId === pair.token0Id
  const amount0In = isToken0In ? amountIn : BigInt(0)
  const amount1In = isToken0In ? BigInt(0) : amountIn
  const amount0Out = isToken0In ? BigInt(0) : amountOut
  const amount1Out = isToken0In ? amountOut : BigInt(0)

  const instance = TokenPair.at(pairAddress)

  const isAlphIn = tokenInId === ALPH_TOKEN_ID
  const attoAlphAmount = isAlphIn ? amountIn + ONE_ALPH : DUST_AMOUNT * BigInt(2)
  // Token amount must be in the token's own decimals; do not add ALPH dust to token amounts
  const tokens = isAlphIn
    ? []
    : [{ id: tokenInId, amount: amountIn }]

  const result = await signExecuteMethod(TokenPair, instance, 'swap', {
    signer,
    args: {
      sender,
      to,
      amount0In,
      amount1In,
      amount0Out,
      amount1Out,
    },
    attoAlphAmount,
    tokens: tokens.length > 0 ? tokens : undefined,
  })

  return { txId: result.txId }
}

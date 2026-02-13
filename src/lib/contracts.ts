import { TokenPair, TokenPairInstance } from './TokenPair'

export { TokenPair, TokenPairInstance }

export function getTokenPairAt(pairAddress: string): TokenPairInstance {
  return TokenPair.at(pairAddress)
}

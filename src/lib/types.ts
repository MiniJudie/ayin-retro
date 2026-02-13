export interface TokenInfo {
  id: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
  description?: string
}

export interface PoolInfo {
  address: string
  tokenPairId: string
  token0: TokenInfo
  token1: TokenInfo
  reserve0: string
  reserve1: string
  poolType?: string
  TVL?: number
  liquidity?: number
}

export interface TokenListResponse {
  networkId: number
  tokens: TokenInfo[]
}

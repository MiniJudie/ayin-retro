// Ayin Retro (V1) on Alephium mainnet – no CLAMM

/** Node RPC URL. Set via NEXT_PUBLIC_NODE_URL. */
export const NODE_URL =
  process.env.NEXT_PUBLIC_NODE_URL || 'https://node.mainnet.alephium.org'

/** Explorer base URL for addresses/transactions. Set via NEXT_PUBLIC_EXPLORER_URL. */
export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://explorer.alephium.org'

/** Explorer backend API (addresses/transactions, public-key). Use for fetch-public-key. */
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.mainnet.alephium.org'

export const ROUTER_ADDRESS = 'vj1SmG6q4gMTA5dRB9TB4pJfyBXdTSNRFbJu2CC38Jw9'
export const ROUTER_CONTRACT_ID = '1e3e4da6d35ddd6c8b4a30c5a580273b1892a14d7540fba5fa8825ce0a046000'

export const POOLS_API = 'https://analytics.ayin.app/api/pools/all'
export const TOKEN_LIST_URL =
  'https://raw.githubusercontent.com/alephium/token-list/master/tokens/mainnet.json'

export const ALPH_TOKEN_ID = '0000000000000000000000000000000000000000000000000000000000000000'

/** Donation address for the Donate button in the footer. Set via NEXT_PUBLIC_DONATION_ADDRESS. */
export const DONATION_ADDRESS =
  process.env.NEXT_PUBLIC_DONATION_ADDRESS || '1DHQcZ2GXvZxETD32CjLEuzirreGiY2XAGX4BH86SasT'

/** AYIN token (contract id). */
export const AYIN_TOKEN_ID = '1a281053ba8601a658368594da034c2e99a0fb951b86498d05e76aedfe666800'
export const AYIN_DECIMALS = 18
/** Liquid staking: mint xAyin from AYIN, burn xAyin for AYIN. */
export const XAYIN_LIQUID_STAKING_ADDRESS = 'zst5zMzizEeFYFis6DNSknY5GCYTpM85D3yXeRLe2ug3'
/** xAyin token id (issued by LiquidStaking contract). */
export const XAYIN_TOKEN_ID = '5bf2f559ae714dab83ff36bed4d9e634dfda3ca9ed755d60f00be89e2a20bd00'

/** Pounder vault: deposit ALPHAYIN (ALPH/AYIN LP token), withdraw gives ALPHAYIN back. */
export const POUNDER_VAULT_ADDRESS = '26gS9VNF7HJmHrV5SCppHGmsyCZKY65uAf3WdN3a6KuDy'
/** ALPHAYIN token id (ALPH/AYIN pool pair token); used for Pounder deposit/withdraw. */
export const ALPHAYIN_TOKEN_ID = 'a7ca90b2af892713ed95f23b37a6db00c0650c16bad1ccc601443e9020f89f00'


export const SINGLE_ALPHAYIN_STAKE_ADDRESS = 'tuuAwnJNwxew6chSHV74CW9Er18EE925Ss2fQMmZbWtF'
export const SINGLE_ALPHAYIN_STAKE_DEPOSIT_TOKEN = '25ywM8iGxKpZWuGA5z6DXKGcZCXtPBmnbQyJEsjvjjWTy' // alph-ayin
/** Single ALPH/AYIN staking uses StakingV4 (StakingAccount sub-contracts). */
export const SINGLE_ALPHAYIN_USE_STAKING_V4 = true

/**
 * Staking contract address by pool pair key (token1_token0 lowercase, e.g. alf_alph).
 * Matches deployement.json pounding section (alfAlphStaking, usdtAlphStaking, etc.).
 */
export const STAKING_BY_PAIR: Record<string, string> = {
  alf_alph: 'w7oLoY2txEBb5nzubQqrcdYaiM8NcCL9kMYXY67YfnUo',
  usdt_alph: 'xoCP1VYdJXoAr6hbmm7dkJAr8e377KXXb8cZ7CZDau5Z',
  ngu_alph: 'ygGeQi98xPZLaE1nqLMJzT2nKtrsaPB4bsoycFjA7RNX',
  usdc_alph: '242tGBfUiKUfVQQE9NL7afobFzfFRaLXSYkoQv84a5Ph9',
  weth_alph: '25QLgDpT7q359tmdxTNhe5FGoxycdLbtKCfvS5ru5XMoM',
  wbtc_alph: 'xo97eZdV6DXuPvx31J8u8KsmwHxmt2eg3KF2nrFGj43Z',
  apad_alph: 'yZYGnp1ZyamEeFKapcjX2WJujMN53bDjP5UtpDVE7M2w',
  cheng_alph: '2AA7Qv5tonApXanqRqVa8wQCzJnyri2Fh3NgBVf7Ji1Ku',
  apad_ayin: '24LktpGb3E6cYDGrN2GshoAAAdByjMM8t5gFX439fcRWw',
  usdc_ayin: '2A7Nky7hk1Q9C66mN6aLLgfyXZWyZXmRfkNYuSMprmXm1',
  usdt_ayin: '26xEgX7N63GCDTZejFhSTsNuUTetbaGtV1mxsyLNBHmyZ',
}

/** Pool keys that use StakingV4 contract; all others use Staking. */
export const STAKING_V4_KEYS = new Set([
  'usdc_alph', 'weth_alph', 'wbtc_alph', 'apad_alph', 'cheng_alph',
  'apad_ayin', 'usdc_ayin', 'usdt_ayin',
])

/**
 * All staking pools from deployement (tokenA, tokenB, contract address).
 * Used to show every pool with staking even if not in the pools API.
 */
export const STAKING_POOLS_DEPLOYMENT: Array<{
  key: string
  tokenA: string
  tokenB: string
  stakingAddress: string
  label: string
}> = [
  
  { key: 'alf_alph', tokenA: '66da610efb5129c062e88e5fd65fe810f31efd1597021b2edf887a4360fa0800', tokenB: ALPH_TOKEN_ID, stakingAddress: STAKING_BY_PAIR.alf_alph!, label: 'ALF / ALPH' },
  { key: 'usdt_alph', tokenA: '556d9582463fe44fbd108aedc9f409f69086dc78d994b88ea6c9e65f8bf98e00', tokenB: ALPH_TOKEN_ID, stakingAddress: STAKING_BY_PAIR.usdt_alph!, label: 'USDT / ALPH' },
  { key: 'ngu_alph', tokenA: 'df3008f43a7cc1d4a37eef71bf581fc4b9c3be4e2d58ed6d1df483bbb83bd200', tokenB: ALPH_TOKEN_ID, stakingAddress: STAKING_BY_PAIR.ngu_alph!, label: 'NGU / ALPH' },
  { key: 'usdc_alph', tokenA: '722954d9067c5a5ad532746a024f2a9d7a18ed9b90e27d0a3a504962160b5600', tokenB: ALPH_TOKEN_ID, stakingAddress: STAKING_BY_PAIR.usdc_alph!, label: 'USDC / ALPH' },
  { key: 'weth_alph', tokenA: '19246e8c2899bc258a1156e08466e3cdd3323da756d8a543c7fc911847b96f00', tokenB: ALPH_TOKEN_ID, stakingAddress: STAKING_BY_PAIR.weth_alph!, label: 'WETH / ALPH' },
  { key: 'wbtc_alph', tokenA: '383bc735a4de6722af80546ec9eeb3cff508f2f68e97da19489ce69f3e703200', tokenB: ALPH_TOKEN_ID, stakingAddress: STAKING_BY_PAIR.wbtc_alph!, label: 'WBTC / ALPH' },
  { key: 'apad_alph', tokenA: 'bb440a66dcffdb75862b6ad6df14d659aa6d1ba8490f6282708aa44ebc80a100', tokenB: ALPH_TOKEN_ID, stakingAddress: STAKING_BY_PAIR.apad_alph!, label: 'APAD / ALPH' },
  { key: 'cheng_alph', tokenA: 'ba17d4a0d35eaf94540c31ce713d61f14b8b92f19f607d59d5f20c8d4042d700', tokenB: ALPH_TOKEN_ID, stakingAddress: STAKING_BY_PAIR.cheng_alph!, label: 'CHENG / ALPH' },
  { key: 'apad_ayin', tokenA: 'bb440a66dcffdb75862b6ad6df14d659aa6d1ba8490f6282708aa44ebc80a100', tokenB: AYIN_TOKEN_ID, stakingAddress: STAKING_BY_PAIR.apad_ayin!, label: 'APAD / AYIN' },
  { key: 'usdc_ayin', tokenA: '722954d9067c5a5ad532746a024f2a9d7a18ed9b90e27d0a3a504962160b5600', tokenB: AYIN_TOKEN_ID, stakingAddress: STAKING_BY_PAIR.usdc_ayin!, label: 'USDC / AYIN' },
  { key: 'usdt_ayin', tokenA: '556d9582463fe44fbd108aedc9f409f69086dc78d994b88ea6c9e65f8bf98e00', tokenB: AYIN_TOKEN_ID, stakingAddress: STAKING_BY_PAIR.usdt_ayin!, label: 'USDT / AYIN' },
]

export const DEFAULT_SLIPPAGE_BPS = 50 // 0.5%
export const DEFAULT_DEADLINE_MIN = 20

import { signExecuteMethod, binToHex, tokenIdFromAddress } from '@alephium/web3'
import type { SignerProvider } from '@alephium/web3'
import { VaultV3 } from './VaultV3'
import { POUNDER_VAULT_ADDRESS, ALPHAYIN_TOKEN_ID } from './config'

/**
 * vALPHAYIN token id (shares issued by Pounder vault); needed to approve assets on withdraw.
 */
export const VALPHAYIN_TOKEN_ID = binToHex(tokenIdFromAddress(POUNDER_VAULT_ADDRESS))

/**
 * Normalize token id to 32-char hex (no 0x) for tx building.
 * Wallet/API may return with 0x; the node often expects without.
 */
function normalizeTokenId(id: string): string {
  const s = (id ?? '').trim().toLowerCase()
  return s.startsWith('0x') ? s.slice(2) : s
}

/** Deposit ALPHAYIN (ALPH/AYIN LP token) into the Pounder vault. Use tokenId from wallet balance key if provided. */
export async function executePounderDeposit(
  signer: SignerProvider,
  _sender: string,
  amount: bigint,
  /** Token id in the same format as wallet balance key (optional; defaults to ALPHAYIN_TOKEN_ID normalized). */
  tokenId?: string
): Promise<{ txId: string }> {
  const instance = VaultV3.at(POUNDER_VAULT_ADDRESS)
  const id = tokenId ? normalizeTokenId(tokenId) : normalizeTokenId(ALPHAYIN_TOKEN_ID)
  const result = await signExecuteMethod(VaultV3, instance, 'deposit', {
    signer,
    args: { amount },
    tokens: [{ id, amount }],
  })
  return { txId: result.txId }
}

/** Withdraw shares from the Pounder vault. Caller must approve vALPHAYIN (share) tokens. */
export async function executePounderWithdraw(
  signer: SignerProvider,
  shares: bigint
): Promise<{ txId: string }> {
  const instance = VaultV3.at(POUNDER_VAULT_ADDRESS)
  const id = normalizeTokenId(VALPHAYIN_TOKEN_ID)
  const result = await signExecuteMethod(VaultV3, instance, 'withdraw', {
    signer,
    args: { shares },
    tokens: [{ id, amount: shares }],
  })
  return { txId: result.txId }
}

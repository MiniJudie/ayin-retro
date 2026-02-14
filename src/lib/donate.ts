import type { SignerProvider } from '@alephium/web3'
import { DUST_AMOUNT } from '@alephium/web3'
import { DONATION_ADDRESS } from './config'

/**
 * Send a donation: ALPH or a token to the donation address.
 * For token transfers, a minimal ALPH amount (dust) is sent for gas.
 */
export async function executeDonate(
  signer: SignerProvider,
  fromAddress: string,
  isAlph: boolean,
  tokenId: string | null,
  amount: bigint
): Promise<{ txId: string }> {
  const attoAlphAmount = isAlph ? amount : DUST_AMOUNT
  const tokens = !isAlph && tokenId ? [{ id: tokenId, amount }] : undefined
  const result = await signer.signAndSubmitTransferTx({
    signerAddress: fromAddress,
    destinations: [
      {
        address: DONATION_ADDRESS,
        attoAlphAmount,
        tokens,
      },
    ],
  })
  return { txId: result.txId }
}

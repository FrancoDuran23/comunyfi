import { getAddress } from "viem";

export const PAYOUT_REPO = "FrancoDuran23/comunyfi";
export const PAYOUT_WORKFLOW_FILE = "payout.yml";
export const PAYOUT_REF = "main";
/** Si en este lapso no vuelve un hash, el bot manda el fallback de la laptop. */
export const PAYOUT_RESULT_WAIT_MS = 3 * 60 * 1000;
/** USA₮ en Celo. Solo se usa como fee currency si PAYOUT_FEE_CURRENCY=usdt. */
export const USDT_FEE_CURRENCY = getAddress("0x0357EE22278c922e1D36cFe6b899269b161880C4");
export const DEFAULT_GAS_DROP_CELO = "0.05";
export const RUNNER_SECRET_HEADER = "x-payout-runner-secret";
export const FALLBACK_COMMAND = "npm run payout";

export function fallbackHint(): string {
  return `En la laptop, con el .env cargado, corré ${FALLBACK_COMMAND}.`;
}

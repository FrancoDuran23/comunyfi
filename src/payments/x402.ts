import type { Address } from "viem";
import { CELO_CHAIN_ID, WARS_TOKEN_ADDRESS } from "../chain.js";

/**
 * Placeholder de x402.
 *
 * Celo liquida HTTP 402 con el facilitador hospedado (wARS está habilitado).
 * Acá solo se describe la cotización: no firma autorizaciones ni llama al facilitador.
 * Cuando se cablee, un recurso pago responde 402, el cliente firma wARS y reintenta
 * con el pago adjunto.
 */
export interface X402PaymentQuote {
  protocol: "x402";
  network: "celo";
  chainId: typeof CELO_CHAIN_ID;
  facilitatorUrl: string;
  asset: Address;
  assetSymbol: "wARS";
  amount: bigint;
  description: string;
}

export function quoteWarsPayment(input: {
  facilitatorUrl: string;
  amount: bigint;
  description: string;
}): X402PaymentQuote {
  if (input.amount < 0n) {
    throw new Error("La cotización x402 no puede ser negativa");
  }
  return {
    protocol: "x402",
    network: "celo",
    chainId: CELO_CHAIN_ID,
    facilitatorUrl: input.facilitatorUrl,
    asset: WARS_TOKEN_ADDRESS,
    assetSymbol: "wARS",
    amount: input.amount,
    description: input.description,
  };
}

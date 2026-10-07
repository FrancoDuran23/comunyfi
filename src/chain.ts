import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

/** Celo mainnet. El hackathon solo cuenta actividad en esta red. */
export const CELO_CHAIN_ID = 42220 as const;

export const DEFAULT_CELO_RPC_URL = "https://forno.celo.org";

/** wARS de Ripio en Celo mainnet. 18 decimales, respaldo 1:1 en pesos. */
export const WARS_TOKEN_ADDRESS = "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d" as const;

export const WARS_DECIMALS = 18;

if (celo.id !== CELO_CHAIN_ID) {
  throw new Error(`viem reporta Celo como ${celo.id}, se esperaba ${CELO_CHAIN_ID}`);
}

export const celoChain = celo;

export function createCeloClient(rpcUrl: string = DEFAULT_CELO_RPC_URL) {
  return createPublicClient({
    chain: celo,
    transport: http(rpcUrl),
  });
}

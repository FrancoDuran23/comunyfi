import { erc20Abi, getAddress, type Address } from "viem";
import { createCeloClient, WARS_TOKEN_ADDRESS } from "../chain.js";

type CeloReader = ReturnType<typeof createCeloClient>;

/** Lee el saldo de wARS de una cuenta. Hace RPC; los tests no lo llaman. */
export async function readWarsBalance(holder: Address, client?: CeloReader): Promise<bigint> {
  const celo = client ?? createCeloClient();
  return celo.readContract({
    address: getAddress(WARS_TOKEN_ADDRESS),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(holder)],
  });
}

import { erc20Abi, getAddress, type Address } from "viem";
import { createCeloClient, WARS_TOKEN_ADDRESS } from "../chain.js";

type CeloReader = ReturnType<typeof createCeloClient>;

export interface PoolBalances {
  wars: bigint;
  celo: bigint;
}

/** Lee el saldo de wARS de una cuenta. Hace RPC; los tests no lo llaman. */
export async function readWarsBalance(holder: Address, client?: CeloReader): Promise<bigint> {
  const balances = await readPoolBalances(holder, client);
  return balances.wars;
}

/** wARS del pozo y CELO nativo para el gas. */
export async function readPoolBalances(holder: Address, client?: CeloReader): Promise<PoolBalances> {
  const celo = client ?? createCeloClient();
  const address = getAddress(holder);
  const [wars, native] = await Promise.all([
    celo.readContract({
      address: getAddress(WARS_TOKEN_ADDRESS),
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
    celo.getBalance({ address }),
  ]);
  return { wars, celo: native };
}

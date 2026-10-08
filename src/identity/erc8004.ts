import type { Address } from "viem";
import { CELO_CHAIN_ID } from "../chain.js";

/**
 * Placeholder de identidad ERC-8004.
 *
 * El hackathon exige un agent id on-chain para que el proyecto sea válido.
 * Registrar en el registry de Celo (se puede mirar en 8004scan.io) y completar
 * ERC8004_REGISTRY_ADDRESS, ERC8004_AGENT_ID y ERC8004_AGENT_WALLET.
 * Este módulo no envía la transacción de registro.
 */
export interface Erc8004Identity {
  standard: "ERC-8004";
  chainId: typeof CELO_CHAIN_ID;
  name: "Comunyfi";
  registry: Address | null;
  agentId: bigint | null;
  agentWallet: Address | null;
  status: "unregistered" | "configured";
}

export interface Erc8004Env {
  erc8004Registry: Address | null;
  erc8004AgentId: bigint | null;
  erc8004AgentWallet: Address | null;
}

export function readErc8004Identity(env: Erc8004Env): Erc8004Identity {
  const configured =
    env.erc8004Registry !== null && env.erc8004AgentId !== null && env.erc8004AgentWallet !== null;
  return {
    standard: "ERC-8004",
    chainId: CELO_CHAIN_ID,
    name: "Comunyfi",
    registry: env.erc8004Registry,
    agentId: env.erc8004AgentId,
    agentWallet: env.erc8004AgentWallet,
    status: configured ? "configured" : "unregistered",
  };
}

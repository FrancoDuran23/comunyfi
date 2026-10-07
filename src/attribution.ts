import { codeFromRepo, toDataSuffix } from "@celo/attribution-tags";
import type { Hex } from "viem";

/**
 * Slug del repo con el que se registra el proyecto en el hackathon.
 * `codeFromRepo` reproduce la derivación de la plataforma de Celo Builders:
 * trim, minúsculas, SHA-256, primeros 6 bytes, prefijo `celo_`.
 */
export const ATTRIBUTION_REPO = "FrancoDuran23/comunyfi";

export function comunyfiAttributionCode(repo: string = ATTRIBUTION_REPO): string {
  return codeFromRepo(repo);
}

export function comunyfiAttributionSuffix(repo: string = ATTRIBUTION_REPO): Hex {
  return toDataSuffix(comunyfiAttributionCode(repo));
}

import { fromDataSuffix } from "@celo/attribution-tags";
import type { Hex } from "viem";
import { comunyfiAttributionCode } from "../attribution.js";

export function calldataHasAttribution(data: Hex): boolean {
  const tag = fromDataSuffix(data);
  return Boolean(tag?.codes.includes(comunyfiAttributionCode()));
}

export function assertCalldataHasAttribution(data: Hex): void {
  if (!calldataHasAttribution(data)) {
    throw new Error("La transacción no lleva la etiqueta celo_40ea7bdf091f");
  }
}

import { formatUnits } from "viem";
import { WARS_DECIMALS } from "./chain.js";

/** Montos en formato argentino: miles con punto y decimales con coma. */
export function formatAmount(amount: bigint, decimals: number, symbol: string): string {
  const formatted = formatUnits(amount, decimals);
  const [whole = "0", fraction = ""] = formatted.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const trimmed = fraction.replace(/0+$/, "");
  const number = trimmed.length > 0 ? `${grouped},${trimmed}` : grouped;
  return `${number} ${symbol}`;
}

export function formatWars(amount: bigint): string {
  return formatAmount(amount, WARS_DECIMALS, "wARS");
}

export function formatCelo(amount: bigint): string {
  return formatAmount(amount, 18, "CELO");
}

import { formatUnits } from "viem";
import { WARS_DECIMALS } from "./chain.js";

/** Montos de wARS en formato argentino: miles con punto y decimales con coma. */
export function formatWars(amount: bigint): string {
  const formatted = formatUnits(amount, WARS_DECIMALS);
  const [whole = "0", fraction = ""] = formatted.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length > 0 ? `${grouped},${trimmed} wARS` : `${grouped} wARS`;
}

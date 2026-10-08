import "dotenv/config";
import { payoutFromEnv } from "../src/payout/cli.js";

try {
  await payoutFromEnv();
} catch (error) {
  const message = error instanceof Error ? error.message : "Falló el pago";
  console.error(message);
  process.exitCode = 1;
}

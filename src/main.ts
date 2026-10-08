import "dotenv/config";
import { comunyfiAttributionCode } from "./attribution.js";
import { configSummary, loadConfig } from "./config.js";
import { formatWars } from "./format.js";
import { readErc8004Identity } from "./identity/erc8004.js";
import { quoteWarsPayment } from "./payments/x402.js";
import { createApp } from "./app.js";
import { prepareWarsTransfer } from "./wallet/payout.js";

const config = loadConfig();
const identity = readErc8004Identity(config);
const quote = quoteWarsPayment({
  facilitatorUrl: config.x402FacilitatorUrl,
  amount: 0n,
  description: "Placeholder: todavía no hay un recurso pago por x402.",
});

console.log("Comunyfi — pozo comunitario en wARS");
console.log(JSON.stringify(configSummary(config), null, 2));
console.log(`Etiqueta de atribución: ${comunyfiAttributionCode()} (${config.attributionRepo})`);
console.log(`Identidad ERC-8004: ${identity.status}`);
console.log(`x402: ${quote.facilitatorUrl} · ${quote.assetSymbol}`);

const app = await createApp(config);
console.log(`Proyectos cargados: ${app.session.listProjects().length}`);
console.log(`Pozo: ${formatWars(config.poolAmount)}`);
console.log(`Fichitas por asistente: ${config.fichitasPerAttendee} (tope ${config.maxFichitasPerProject} por proyecto)`);

const sample = app.session.listProjects()[0];
if (sample) {
  const preview = prepareWarsTransfer(sample.recipient, 1n * 10n ** 18n);
  console.log("Vista previa de un transfer de 1 wARS (no se envía):");
  console.log(`  token ${preview.token}`);
  console.log(`  hacia ${preview.recipient}`);
  console.log(`  chainId ${preview.chainId}`);
  console.log(`  data ${preview.data}`);
}

console.log("Ensayo local: npm run live");
console.log("Tests: npm test");

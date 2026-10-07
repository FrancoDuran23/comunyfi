import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress, parseUnits } from "viem";
import { loadConfig, configSummary } from "../src/config.js";
import { formatWars } from "../src/format.js";
import { readErc8004Identity } from "../src/identity/erc8004.js";
import { quoteWarsPayment } from "../src/payments/x402.js";
import { demoProjectsPath, loadProjectsFile } from "../src/projects.js";
import { WARS_TOKEN_ADDRESS } from "../src/chain.js";

test("la config de ejemplo no exige secretos y el resumen no los muestra", () => {
  const config = loadConfig({
    AGENT_PRIVATE_KEY: `0x${"11".repeat(32)}`,
    TELEGRAM_BOT_TOKEN: "123:secreto",
    POOL_AMOUNT_WARS: "50000",
    PAYOUT_DRY_RUN: "true",
  });
  assert.equal(config.chainId, 42220);
  assert.equal(config.rpcUrl, "https://forno.celo.org");
  assert.equal(config.warsToken, getAddress(WARS_TOKEN_ADDRESS));
  assert.equal(config.poolAmount, parseUnits("50000", 18));
  assert.equal(config.fichitasPerAttendee, 100);
  assert.equal(config.maxFichitasPerProject, 40);
  assert.equal(config.dryRun, true);
  assert.equal(config.attributionRepo, "FrancoDuran23/comunyfi");

  const summary = JSON.stringify(configSummary(config));
  assert.equal(summary.includes("secreto"), false);
  assert.equal(summary.includes("0x1111"), false);
  assert.equal(configSummary(config).signerConfigured, true);
});

test("rechaza otra red, otro token y un tope imposible", () => {
  assert.throws(() => loadConfig({ CELO_CHAIN_ID: "44787" }), /42220/);
  assert.throws(() => loadConfig({ WARS_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000001" }), /wARS/i);
  assert.throws(
    () => loadConfig({ FICHITAS_PER_ATTENDEE: "10", MAX_FICHITAS_PER_PROJECT: "40" }),
    /no puede superar/,
  );
});

test("el formato de wARS usa separadores argentinos", () => {
  assert.equal(formatWars(parseUnits("50000", 18)), "50.000 wARS");
  assert.equal(formatWars(parseUnits("1500.5", 18)), "1.500,5 wARS");
});

test("ERC-8004 y x402 quedan como placeholders hasta configurarlos", () => {
  const empty = readErc8004Identity({
    erc8004Registry: null,
    erc8004AgentId: null,
    erc8004AgentWallet: null,
  });
  assert.equal(empty.status, "unregistered");
  assert.equal(empty.chainId, 42220);

  const quote = quoteWarsPayment({
    facilitatorUrl: "https://api.x402.celo.org",
    amount: parseUnits("1", 18),
    description: "lectura",
  });
  assert.equal(quote.protocol, "x402");
  assert.equal(quote.network, "celo");
  assert.equal(quote.assetSymbol, "wARS");
  assert.equal(quote.chainId, 42220);
});

test("el archivo de ejemplo carga cuatro proyectos de la ronda", async () => {
  const projects = await loadProjectsFile(demoProjectsPath());
  assert.equal(projects.length, 4);
  assert.deepEqual(
    projects.map((project) => project.id),
    ["agua", "residuos", "conectividad", "oficio"],
  );
});

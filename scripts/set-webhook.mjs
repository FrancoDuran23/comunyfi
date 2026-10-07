const base = process.env.WORKER_URL?.trim().replace(/\/+$/, "");
const setupSecret = process.env.SETUP_SECRET?.trim();

if (!base || !setupSecret) {
  console.error("Definí WORKER_URL (https://comunyfi.<subdominio>.workers.dev) y SETUP_SECRET.");
  process.exit(1);
}

const response = await fetch(`${base}/setup`, {
  method: "POST",
  headers: { authorization: `Bearer ${setupSecret}` },
});
const body = await response.text();
console.log(body);
if (!response.ok) process.exit(1);

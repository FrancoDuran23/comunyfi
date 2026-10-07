# Comunyfi

Pozo comunitario en wARS para la gente de [jujuy.dev](https://jujuy.dev). Proyecto para el hackathon **Agents on Open Rails**, track **Stable Agents: LatAm** (Ripio × Celo).

Un agente custodia el pozo en su wallet de Celo. En el evento, quien hizo check-in en Luma recibe fichitas por Telegram, las reparte entre proyectos que atacan un problema local, y un tablero se proyecta con el recuento. Después de cerrar la votación y de una aprobación humana, el agente paga en wARS, en proporción a las fichitas.

## Runbook del evento

Hace falta Node 22.5 o más (usa `node:sqlite`). El archivo `.nvmrc` fija la 22.

### 1. Crear el bot

1. En Telegram, abrí [@BotFather](https://t.me/BotFather).
2. Mandá `/newbot`.
3. Nombre visible: `Comunyfi`. Usuario: uno libre que termine en `bot`, por ejemplo `comunyfi_jujuy_bot`.
4. BotFather te da un token. Copialo. No lo subas a GitHub.
5. Escribile `/start` a tu bot una vez que esté corriendo. Te responde con tu id numérico. Ese número va en `ADMIN_TELEGRAM_IDS`. Si hay más de una persona de la organización, separá los ids con coma.

Al arrancar, el bot publica los comandos solo. No hace falta cargarlos a mano en BotFather.

### 2. Configurar el entorno

```bash
cp .env.example .env
npm install
```

Completá en `.env`, y en ningún otro lado:

| Variable | Quién la tiene | Para qué |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather | El bot no arranca sin esto |
| `ADMIN_TELEGRAM_IDS` | El `/start` del bot | Quién puede armar la ronda y pagar |
| `LUMA_API_KEY` | [luma.com/calendar/manage/api-keys](https://luma.com/calendar/manage/api-keys) | Check-in real. La key es del calendario y pide Luma Plus |
| `LUMA_EVENT_ID` | La URL o el dashboard del evento, empieza con `evt-` | El evento de esa noche |
| `AGENT_PRIVATE_KEY` | La wallet que tiene el pozo | Solo para un pago real |
| `PAYOUT_DRY_RUN` | Vos | `true` ensaya. `false` manda wARS |
| `AGENT_WALLET` | La misma wallet, si todavía no querés pegar la clave | Para que `/pozo` muestre el saldo |

Sin `LUMA_API_KEY`, el bot usa `LUMA_GUESTS_FILE` (CSV o JSON con `email,name,guestId,checkedIn`). El ejemplo está en `data/guests.example.json`: `ana@jujuy.dev` ya figura con check-in.

### 3. Ensayo, sin token y sin Luma

```bash
npm test
npm start
npm run board
```

`npm test` no habla con Telegram ni con Luma: simula la API. `npm start` imprime la etiqueta y una transferencia de 1 wARS, y no la envía. El tablero queda en `http://127.0.0.1:3000/` y se refresca solo.

### 4. La noche del evento

```bash
npm run live
```

Eso levanta el tablero y el bot en el mismo proceso, con la misma base SQLite (`data/comunyfi.sqlite`). Si se corta la luz y reiniciás, los votos siguen.

En el proyector, abrí `http://127.0.0.1:3000/`.

Por Telegram, como organización:

1. `/ronda` muestra la ronda. Si no hay, `/ronda nueva jujuy.dev`.
2. Cargá cada proyecto: `/proyecto agua | Agua en barrios altos | Cisternas comunitarias | 0xWALLET`.
3. Si te equivocaste: `/editar agua | Nombre | Resumen | 0xWALLET`.
4. `/abrir` habilita las fichitas. `/cerrar` las congela.
5. `/resultados` y el proyector muestran el mismo recuento.
6. `/previsualizar` arma el reparto y no manda nada.
7. `/aprobar` con `PAYOUT_DRY_RUN=true` (el default) ensaya y te muestra la etiqueta `celo_40ea7bdf091f`.
8. Para pagar de verdad: `PAYOUT_DRY_RUN=false`, `AGENT_PRIVATE_KEY` cargada, reiniciá `npm run live`, `/aprobar` y después `/aprobar CONFIRMAR` dentro de 5 minutos. El bot responde con los links de Celoscan.

Cada asistente:

1. `/start`
2. Manda el mail con el que se anotó en Luma. Tiene que figurar con check-in (`checked_in_at` en la API, o `checkedIn: true` en el archivo).
3. `/proyectos` y toca un proyecto. El teclado pone 10, 20, 30 o 40 fichitas, o las saca. El número reemplaza lo anterior.
4. `/fichitas` muestra su resumen. `/pozo` muestra wARS y CELO de gas de la wallet del agente.

## Anti-abuso

- Un mail de Luma, un Telegram. Un Telegram, un mail. No se cruzan.
- 100 fichitas por persona y 40 como máximo en un mismo proyecto. Reasignar reemplaza, no suma encima del tope.
- Sin check-in no hay fichitas. Sin votación abierta no se pueden mover.
- Cerrar la votación congela el reparto. El pago real rechaza direcciones de relleno (`0x000…0001`).
- Un pago que llega a salir queda anotado: no se vuelve a mandar a esa wallet si reintentás.

## Etiqueta de atribución

Cada `transfer` de wARS lleva el sufijo ERC-8021 de `@celo/attribution-tags`, derivado con `codeFromRepo`:

`FrancoDuran23/comunyfi` → `celo_40ea7bdf091f`

Celo mainnet (`chainId` 42220, RPC `https://forno.celo.org`). wARS: `0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d`, 18 decimales.

## Qué está mockeado en este repo

Acá no hay token de Telegram ni API key de Luma, y no se mandó ninguna transacción.

- Los tests del bot usan grammY con la API interceptada. No llaman a `api.telegram.org`.
- Luma se prueba con un `fetch` falso y con `data/guests.example.json`. El cliente real está en `src/luma/checkin.ts` y pega a `GET /v1/events/guests/get` cuando existen `LUMA_API_KEY` y `LUMA_EVENT_ID`.
- El pago real usa viem, pero el default es dry-run. Sin `AGENT_PRIVATE_KEY` no hay firma.
- ERC-8004 y x402 siguen siendo placeholders. El agent id hay que registrarlo aparte (8004scan) para que el track sea válido.

## Qué tiene que pasar Franco para correrlo en vivo

1. El token de BotFather (`TELEGRAM_BOT_TOKEN`).
2. Su id de Telegram y el de quien más administre (`ADMIN_TELEGRAM_IDS`).
3. `LUMA_API_KEY` del calendario y el `LUMA_EVENT_ID` (`evt-…`) de la noche. Si Luma Plus no llega, un CSV exportado con mail, nombre, id y si ya hizo check-in.
4. Las wallets de cada proyecto, en lugar de las de relleno.
5. La clave de la wallet del pozo, recién cuando quieran pagar (`AGENT_PRIVATE_KEY`) y `PAYOUT_DRY_RUN=false`.
6. Un poco de CELO en esa wallet para el gas. `/pozo` lo muestra si la dirección está configurada.

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm test` | Fichitas, Luma simulado, bot simulado, dry-run y persistencia |
| `npm run typecheck` | TypeScript estricto |
| `npm run build` | Compila a `dist/` |
| `npm start` | Resumen y vista previa, sin enviar |
| `npm run live` | Tablero + bot en long polling, para tu máquina |
| `npm run start:prod` | Lo mismo, ya compilado, sin tsx. En alwaysdata es el comando del sitio |
| `npm run board` | Solo el proyector |
| `npm run bot` | Solo el bot, en long polling |
| `npm run worker:dev` | Worker local con wrangler |
| `npm run worker:deploy` | Deploy a Cloudflare Workers |
| `npm run worker:set-webhook` | `POST /setup` del worker ya desplegado |

`npm run build` deja `dist/live.js`. `npm run start:prod` lo corre con `node --experimental-sqlite --disable-warning=ExperimentalWarning`.

## Hosting en Cloudflare Workers

alwaysdata Free pide tarjeta. El deploy va a **Cloudflare Workers Free**, que no. El proceso de Node (`npm run live`, webhook o long polling) queda para tu máquina y para los tests.

El Worker no puede hacer long polling: cada request entra, corre y termina. Telegram pega a `POST /telegram/<WEBHOOK_SECRET>`. grammY lo atiende con `webhookCallback(bot, "cloudflare-mod", { secretToken })`. El mismo fetch sirve el tablero (`/`, `/health`, `/api/tablero`). El estado de la votación vive en **un solo Durable Object** con SQLite (`new_sqlite_classes` en `wrangler.toml`, que es el backend que permite el plan Free). Cada update y cada lectura del tablero entran a esa instancia, así que las fichitas no se parten entre copias.

Los invitados y proyectos de ejemplo van empaquetados en el bundle (`data/guests.example.json` y `data/projects.example.json`). En el Worker no hay disco.

El dry-run es el default (`PAYOUT_DRY_RUN=true`) y tiene que alcanzar para el evento de ensayo: arma el `transfer` de wARS con la etiqueta `celo_40ea7bdf091f` y no firma. Un pago real firma con viem **dentro del request**. En el plan Free el CPU es de **10 ms por invocación** (la espera de red no cuenta). Varias firmas secp256k1 pueden pasarse de ese tope y el request muere con error de CPU. Si pasa, el ensayo igual quedó; el pago en vivo pide el plan de pago de Workers, que sube ese límite.

### 1. Cuenta y credenciales

1. Creá una cuenta en [dash.cloudflare.com](https://dash.cloudflare.com). El plan Free de Workers no pide tarjeta.
2. El **account id** está en el overview de la cuenta (Workers & Pages también lo muestra). Es un hex de 32 caracteres. No lo subas al repo. Exportalo:

```bash
export CLOUDFLARE_ACCOUNT_ID=el-id-de-32-caracteres
```

3. Autenticación, una de las dos:

- `npx wrangler login` (OAuth en el browser). Alcanza para deploy y secretos.
- Un API token en My Profile → API Tokens → Create Custom Token. Permisos de cuenta:
  - **Workers Scripts Write** (en la UI nueva: rol **Admin** de Workers la primera vez, porque el script todavía no existe; después alcanza **Editor** para `wrangler deploy` y `wrangler secret put`).
  - El nombre viejo del mismo permiso es **Workers Scripts Edit**.
  - No hace falta permiso de zona si publicás en `*.workers.dev` (el default). Si más adelante sumás un dominio propio, sumá **Workers Routes Write** en esa zona.

```bash
export CLOUDFLARE_API_TOKEN=el-token
```

### 2. Secretos

Desde la raíz del repo, con la cuenta ya autenticada. El worker tiene que existir, así que si `secret put` dice que no está desplegado, hacé el deploy del paso 3 primero y volvé acá.

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put SETUP_SECRET
```

Opcionales, solo si los vas a usar:

```bash
npx wrangler secret put ADMIN_TELEGRAM_IDS
npx wrangler secret put LUMA_API_KEY
npx wrangler secret put LUMA_EVENT_ID
npx wrangler secret put AGENT_PRIVATE_KEY
```

`WEBHOOK_SECRET`: 1 a 256 caracteres, `A-Z`, `a-z`, `0-9`, `_` o `-`. Es el path y el `secret_token`. `SETUP_SECRET` protege `POST /setup`. `PAYOUT_DRY_RUN` ya está en `true` en `wrangler.toml`. Para local, copiá `.dev.vars.example` a `.dev.vars`.

### 3. Deploy

```bash
npm install
npm run worker:deploy
```

Wrangler imprime la URL, algo como `https://comunyfi.<subdominio>.workers.dev`.

### 4. Webhook

```bash
export WORKER_URL=https://comunyfi.<subdominio>.workers.dev
export SETUP_SECRET=el-mismo-del-secret
npm run worker:set-webhook
```

Eso hace `POST /setup` con `Authorization: Bearer`. El worker publica los comandos y llama a `setWebhook` con `${WORKER_URL}/telegram/${WEBHOOK_SECRET}`. Si definiste `WEBHOOK_URL` como var, usa esa; si no, el origen del request.

### 5. Chequeo

```bash
curl "$WORKER_URL/health"
```

Tiene que responder `ok`. Abrí `$WORKER_URL/` y tenés que ver los cuatro proyectos de ejemplo. En Telegram, `/start` al bot. Si no responde, el webhook no quedó registrado o el secreto no coincide.

Para actualizar: `git pull`, `npm install`, `npm run worker:deploy`. Los secretos se quedan. Volvé a correr `worker:set-webhook` solo si cambió la URL o el `WEBHOOK_SECRET`.

## Hosting en alwaysdata

Quedó como alternativa de Node. El plan Free pide tarjeta, así que el deploy elegido es Cloudflare, arriba. Si más adelante hay un VPS, este modo sigue valiendo.

El plan Free tiene disco de verdad y Node 22, pero el sitio se apaga cuando nadie lo usa y las condiciones no permiten un proceso siempre prendido. El long polling de Telegram (`getUpdates`) es un proceso así, así que en alwaysdata no va. En tu máquina, sin `WEBHOOK_URL`, `npm run live` sigue en long polling.

En el panel, sitio tipo **Node.js**:

| Campo | Valor |
| --- | --- |
| Comando | `npm run start:prod` |
| Directorio de trabajo | la raíz del repo |
| `NODEJS_VERSION` | `22` |
| Tiempo de inactividad | `0` (se duerme; el webhook lo despierta) |

Variables de entorno, además de las del runbook:

| Variable | Valor |
| --- | --- |
| `WEBHOOK_URL` | El origen público https que te da alwaysdata, sin path y sin barra final. Ejemplo: `https://comunyfi.alwaysdata.net` |
| `WEBHOOK_SECRET` | Un string largo al azar: letras, números, `_` y `-`, hasta 256 caracteres |
| `IP` y `PORT` | Las pone alwaysdata. No las escribas a mano. Si `IP` está, el proceso escucha solo ahí; si no, en todas las interfaces |

Al arrancar con `WEBHOOK_URL`, el proceso publica los comandos y registra el webhook en `${WEBHOOK_URL}/telegram/${WEBHOOK_SECRET}` con `secret_token` igual a `WEBHOOK_SECRET`. No llama a `bot.start()`. El mismo servidor del tablero atiende `POST /telegram/<secreto>` (grammY, adaptador `http`, chequea el header) antes del 405 del resto de los POST.

Para actualizar el sitio:

```bash
git pull
npm ci
npm run build
```

Después reiniciá el sitio desde el panel.

## Estructura

```
src/telegram/      bot grammY, comandos y teclados
src/voting/        fichitas, topes y reparto
src/store/         SQLite de la ronda
src/luma/          API de Luma y archivo local
src/wallet/        transfer de wARS con etiqueta, dry-run y saldos
src/projector/     tablero
src/worker.ts      entrada de Cloudflare Workers y el Durable Object
src/identity/      stub ERC-8004
src/payments/      stub x402
```

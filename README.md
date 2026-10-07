# Comunyfi

Pozo comunitario en wARS para la gente de [jujuy.dev](https://jujuy.dev). Es un esqueleto en TypeScript para el hackathon **Agents on Open Rails**, track **Stable Agents: LatAm** (Ripio × Celo).

Un agente custodia el pozo en su wallet de Celo. En un evento en vivo, quien hizo check-in en Luma recibe fichitas por Telegram, las reparte entre proyectos que atacan un problema local, y un tablero se proyecta con el recuento. Después de una aprobación humana, el agente paga en wARS, en proporción a las fichitas.

## Cómo funciona

1. El pozo (en el ejemplo, ARS 50.000) está en wARS en la wallet del agente. wARS es el peso de Ripio en Celo: `0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d`, 18 decimales.
2. Cada asistente verifica su check-in de Luma con el bot (`/vincular`). El esqueleto todavía no llama a la API de Luma: usa una lista o, en demo, ids `guest_<nombre>`.
3. Recibe un presupuesto de fichitas (100) con un tope por proyecto (40). Así nadie pone todo en una sola propuesta.
4. `/asignar agua 20` suma fichitas. El tablero (`npm run board` o `npm run live`) se refresca solo para el proyector.
5. La organización manda `/aprobar`. Recién ahí `/pagar` arma las transferencias ERC-20. Con `PAYOUT_DRY_RUN=true` no se envía nada.

## Anti-abuso

- Un invitado de Luma, una vez. Un Telegram, una vez. No se pueden vincular cruzados.
- Presupuesto fijo y tope por proyecto.
- La votación se cierra cuando hay aprobación. No entra nadie más ni se cambian fichitas.
- El pago real rechaza las direcciones de relleno (`0x000…0001`, etc.).
- Sin `AGENT_PRIVATE_KEY` no hay firma. El modo dry-run es el default.

## Etiqueta de atribución

Cada `transfer` de wARS lleva el sufijo ERC-8021 de `@celo/attribution-tags`, derivado del repo con `codeFromRepo`:

`FrancoDuran23/comunyfi` → `celo_40ea7bdf091f`

Celo mainnet (`chainId` 42220, RPC `https://forno.celo.org`). La etiqueta tiene que estar antes de la primera transacción que quieras que cuente en el hackathon.

## Qué falta a propósito

- **Luma:** `src/luma/checkin.ts` no pega a la API. Hay que reemplazar el validador por el check-in real del evento.
- **ERC-8004:** `src/identity/erc8004.ts` solo lee las variables. El agent id se registra aparte (8004scan) y es obligatorio para el track.
- **x402:** `src/payments/x402.ts` describe una cotización en wARS contra el facilitador de Celo. No firma ni liquida.

## Cómo correrlo

Hace falta Node 20 o más.

```bash
cp .env.example .env
npm install
npm test
npm start
```

`npm start` imprime la etiqueta, el pozo y una transferencia de ejemplo. No manda nada a la red.

```bash
npm run board   # tablero en http://127.0.0.1:3000/
npm run bot     # bot de Telegram (pide TELEGRAM_BOT_TOKEN)
npm run live    # tablero y bot en el mismo proceso, misma votación
```

Comandos del bot: `/vincular`, `/proyectos`, `/fichitas`, `/asignar`, `/tablero`. Quienes estén en `ADMIN_TELEGRAM_IDS` también tienen `/aprobar` y `/pagar`.

Para ensayar sin Luma, dejá `LUMA_ALLOW_PLACEHOLDER=true` y usá `/vincular guest_ana`. En el evento poné ese flag en `false` y completá `LUMA_CHECKED_IN_GUESTS` (hasta que exista la API).

Los proyectos de muestra están en `data/projects.example.json`. Cambiá `recipient` por la wallet de cada equipo antes de un pago real, y `SEED_DEMO=false` si cargás `PROJECTS_FILE` con la ronda de verdad.

## Variables

Están documentadas en `.env.example`. No hay secretos en el repo. `AGENT_PRIVATE_KEY` y `TELEGRAM_BOT_TOKEN` se completan solo en tu `.env`.

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm test` | Tests de fichitas, topes, reparto, etiqueta y dry-run |
| `npm run typecheck` | TypeScript estricto |
| `npm run build` | Compila a `dist/` |
| `npm start` | Resumen y vista previa, sin enviar |
| `npm run live` | Tablero + bot con el estado compartido |

## Estructura

```
src/voting/        fichitas, topes y reparto proporcional
src/wallet/        transfer de wARS con etiqueta, dry-run y saldo
src/telegram/      bot grammY
src/luma/          stub de check-in
src/identity/      stub ERC-8004
src/payments/      stub x402
src/projector/     tablero para el proyector
```

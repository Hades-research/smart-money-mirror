# Deploying Smart Money Mirror

Zero-dependency Node app — no build step. Any Node 18+ host works; Railway and
Render one-click from GitHub are the fastest paths.

## 1. Push to your GitHub

This folder is a standalone git repo. Create an empty repo on your GitHub
(e.g. `smart-money-mirror`), then:

```bash
git remote add origin https://github.com/<your-username>/smart-money-mirror.git
git push -u origin main
```

## 2. Create the service (Railway shown; Render is equivalent)

1. railway.app → New Project → **Deploy from GitHub repo** → pick `smart-money-mirror`
2. It auto-detects Node and uses `npm start` (wired to `node src/server.js`)
3. The server reads `PORT` from the environment automatically — no config needed
4. Settings → **Networking → Generate Domain** → this is your public URL

## 3. Environment variables

| Variable | Value | When |
|---|---|---|
| `X402_MODE` | `mock` | now — endpoint demonstrates the full 402 handshake without creds |
| `X402_PAY_TO` | `0x8dee13da6fedf99b16468ec05dd219dec7e1221d` | now — owner payout wallet (X Layer) |
| `OKX_X402_API_KEY` | from web3.okx.com/onchain-os/dev-portal | before charging real money |
| `OKX_X402_SECRET` | 〃 | 〃 |
| `OKX_X402_PASSPHRASE` | 〃 | 〃 |
| then set `X402_MODE` | `real` | 〃 |

Note: **real alert delivery** (Telegram) needs a bot token from @BotFather — separate
from the x402 payment creds, only needed once you move delivery off the mock
console/log. The listing itself does not require it.

## 4. Verify

```
https://<your-domain>/api/health   → {"ok":true,...}
https://<your-domain>/             → trading-terminal feed
POST https://<your-domain>/api/subscribe  → 402 challenge (when X402_MODE≠off)
```

## 5. Register the endpoint

Your on-chain service endpoint (permanent) is:

```
https://<your-domain>/api/subscribe
```

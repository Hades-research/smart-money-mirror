# OKX.AI Listing Manifest — Smart Money Mirror

The submission record for listing this agent on OKX.AI. Listing is an **on-chain
identity + service registration on X Layer** via the Onchain OS CLI — not a web
form. Fill the two `REPLACE_*` placeholders, then run the command sequence below.

## Canonical manifest

```json
{
  "role": "asp",
  "identity": {
    "name": "Smart Money Mirror",
    "description": "Smart Money Mirror watches OKX's top leaderboard traders and alerts you the moment one opens, closes or flips a position — each alert carrying a one-paragraph read on the move's size, conviction and market context. Includes a weekly digest of the biggest moves. Follow the money that actually wins, filtered from the noise.",
    "avatar_file": "./brand/avatar.png",
    "preferred_language": "en"
  },
  "services": [
    {
      "name": "Whale Move Alerts",
      "description": "Streams significance-scored alerts when leaderboard traders open, close or flip positions, each with an analyst take and market context, plus a weekly digest of the top moves and a ready-to-share summary. You supply: a delivery handle (email or Telegram) and, optionally, a custom significance threshold. Read-only market intelligence.",
      "type": "A2MCP",
      "fee": "7",
      "fee_currency": "USDT",
      "endpoint": "https://REPLACE_WITH_YOUR_DEPLOY_HOST/api/subscribe"
    }
  ]
}
```

- **`REPLACE_WITH_YOUR_DEPLOY_HOST`** → your deployed domain. The local routes are
  `POST /api/subscribe` and `GET /api/events` (see [STATUS.md](STATUS.md)); must be
  a public `https://` URL (permanent on-chain).
- **`avatar.png`** → required uploaded image. Trading-terminal identity: neon-green
  radar / mirror motif on near-black. Put it at `brand/avatar.png`.
- **fee** `"7"` = 7 USDT / month subscription. Adjust freely; digits only,
  ≤6 decimals, currency is USDT.

## Registration command sequence

```bash
# 0. Wallet session (TEE) — identities live on X Layer only, never pass --chain
onchainos wallet status --format json
onchainos wallet login <your-email>        # then: onchainos wallet verify <code>

# 1. Consent / eligibility (one ASP identity per wallet)
onchainos agent pre-check --role asp

# 2. Upload the avatar, capture the returned URL for --picture
onchainos agent upload --file ./brand/avatar.png

# 3. Automated listing QA — fix any findings before create
onchainos agent validate-listing --role asp \
  --name "Smart Money Mirror" \
  --description "Smart Money Mirror watches OKX's top leaderboard traders and alerts you the moment one opens, closes or flips a position — each alert carrying a one-paragraph read on the move's size, conviction and market context. Includes a weekly digest of the biggest moves. Follow the money that actually wins, filtered from the noise." \
  --service '[{"name":"Whale Move Alerts","description":"Streams significance-scored alerts when leaderboard traders open, close or flip positions, each with an analyst take and market context, plus a weekly digest of the top moves and a ready-to-share summary. You supply: a delivery handle (email or Telegram) and, optionally, a custom significance threshold. Read-only market intelligence.","type":"A2MCP","fee":"7","endpoint":"https://REPLACE_WITH_YOUR_DEPLOY_HOST/api/subscribe"}]'

# 4. Create the on-chain identity → returns newAgentId
onchainos agent create --role asp \
  --name "Smart Money Mirror" \
  --description "<same description as above>" \
  --picture "<url from step 2>" \
  --service '<same --service JSON as above>'

# 5. Activate → submits for review / publishes
onchainos agent activate --agent-id <newAgentId> --preferred-language en
```

On-chain fees are covered by OKX (X Layer is gas-free). Settlement is in USDT.

## Owner values — REGISTERED (Jul 3, 2026)

| Field | Value |
|---|---|
| **Agent ID** | **3626** (X Layer, chain 196) |
| Registration tx | `0x14d14e1368b0de5f99fc845fde5427909bf861342f3940495e4667d82f47f2cb` |
| Status | **submitted for review** (`approvalStatus: 2`); result → owner email in ~2 business days |
| Owner email / wallet login | opinionyu@plengerfinal.my.id |
| Payout wallet (X Layer, `X402_PAY_TO`) | `0x8dee13da6fedf99b16468ec05dd219dec7e1221d` |
| Avatar (uploaded) | `https://static.okx.com/cdn/web3/wallet/marketplace/headimages/agent/avatar/7683cbbe-385f-4418-a054-f5273cd5f075.png` |
| Endpoint (on-chain, permanent) | `https://smart-money-mirror-production.up.railway.app/api/subscribe` — passes `x402-check` |
| Repo | github.com/Hades-research/smart-money-mirror |
| Railway note | needed `HOST=0.0.0.0` env var (server defaulted to 127.0.0.1) |

**Registration schema (proven):** `--service` keys camelCase; `serviceDescription`
two lines (capability `\n` what-user-supplies); endpoint must pass `x402-check`.

## Owner checklist

- [x] x402 pay-per-call layer built on `POST /api/subscribe` (A2MCP requirement):
      402 handshake + PAYMENT-REQUIRED/PAYMENT-RESPONSE headers, 7 USDT
      (`7000000` atomic units) on X Layer (`eip155:196`). **Mock mode verified**
      end-to-end (`npm run x402-demo`, 11 unit tests); real-mode facilitator
      creds (`OKX_X402_*`) + owner wallet (`X402_PAY_TO`) still pending — see
      STATUS.md → "x402 payment layer"
- [ ] Deploy the service; set the real `https://` endpoint (replace the placeholder)
- [x] Create `brand/avatar.png` — done (1024×1024, neon radar sweep with whale blips on near-black; editable source at `brand/avatar.svg`)
- [ ] Register hackathon + OKX Onchain OS dev-portal creds (`.env`); create the
      Telegram bot token for real alert delivery
- [ ] Run steps 0-5 above; record `newAgentId`
- [ ] Confirm activation status (submitApproval → under review)
- [ ] Submit the hackathon Google form before **Jul 17 00:00 UTC**
- [ ] Post the ≤90s demo on X with **#okxai**

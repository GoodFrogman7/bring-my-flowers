# Testing Guide

## Automated tests (Vitest)

```bash
npm test             # run once
npm run test:watch   # watch mode
```

The suite lives in `tests/` and mocks the LLM (`OllamaClient`), storage, and messaging — no Ollama, Twilio, or network access is needed. Coverage:

- `orderSession` — quantity parsing ("10", "a dozen"), session TTL expiry
- `fuzzyMatch` — typos ("rozes"), plurals ("lilies" → "Lily"), thresholds
- `messageHandler` — intent routing, the full multi-turn order flow (missing slots, low stock, no match, confirmation YES/NO, abort), rate limiting, error recovery
- `ollama` — JSON response parsing and the regex fallback classifier when the LLM is unreachable
- `twilioSignature` — webhook signature acceptance/rejection
- `paymentWebhook` — Razorpay signature verification, paid/expired/cancelled event handling and stock return

## Live Ollama smoke test

```bash
npm run test:ollama
```

Verifies the real Ollama endpoint responds and classifies a few sample messages.

## Manual end-to-end testing

Seed sample data first (Excel modes): `npm run add:sample`

Send these from a phone connected to your bot (sandbox-joined for Twilio modes):

| Send | Expect |
|------|--------|
| `I want 5 roses for tomorrow` | Order summary + confirmation prompt (or payment link in enhanced mode) |
| `I want roses` → `5` → `tomorrow` | Same, collected across messages |
| `nevermind` (mid-order) | Order draft cleared |
| `No delivery today` | Upcoming order cancelled, stock returned |
| `Deliver on Monday instead` | Order rescheduled |
| `Do you have lilies?` | Answer from live inventory |

Watch `logs/app.log` while testing — every classification and action is logged with its confidence.

### Enhanced-mode extras

- **Payment**: place an order, pay the Razorpay test link, confirm the order flips to CONFIRMED in the sheet and a calendar event appears. Let a link sit 24h (or cancel it) and confirm stock returns.
- **Voice**: call the Twilio number, speak an order after the beep, expect a WhatsApp follow-up.
- **Languages**: send `أريد 5 وردة` (AR) or `मुझे 5 गुलाब चाहिए` (HI) — replies use the detected language's templates.
- **Webhook security**: `curl -X POST https://<ngrok>/webhook/whatsapp -d "From=+911&Body=hi"` must return **403** (no Twilio signature).

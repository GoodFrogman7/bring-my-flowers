# Testing Guide

## Automated tests (Vitest)

```bash
npm test             # run once
npm run test:watch   # watch mode
```

The suite lives in `tests/` and mocks the LLM (`OllamaClient`), storage, and messaging — no Ollama, Twilio, or network access is needed. Coverage:

- `orderSession` — quantity parsing ("10", "a dozen"), session TTL expiry
- `orderItems` — line-item encoding ("5 Roses, 3 Lilies") round-trip and legacy-row fallback
- `fuzzyMatch` — typos ("rozes"), plurals ("lilies" → "Lily"), thresholds
- `messageHandler` — intent routing, the full multi-turn order flow (missing slots, low stock, no match, confirmation YES/NO, abort), rate limiting, error recovery
- `recurringFlow` — subscription creation conversation, day collection, pause/resume/cancel management, owner-vs-customer routing
- `recurrence` — cadence parsing ("every Monday", "monthly on the 5th") and next-date math
- `dailyOps` — recurring-order materialization (due/overdue/paused, stock shortage alerts, failure retry) and delivery reminders
- `ownerCommands` — every owner command, phone normalization across transports, failure safety
- `excelManager` — real .xlsx round-trip in a temp dir, including legacy-workbook upgrade
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
| `5 roses and 3 lilies for tomorrow` | Itemized summary with per-line prices and a total |
| `I want roses` → `5` → `tomorrow` | Same, collected across messages |
| `nevermind` (mid-order) | Order draft cleared |
| `10 roses every Monday` → `yes` | Subscription created with first-delivery date |
| `pause my subscription` / `cancel my subscription` | Subscription paused/cancelled |
| `No delivery today` | Upcoming order cancelled, stock returned |
| `Deliver on Monday instead` | Order rescheduled |
| `Do you have lilies?` | Answer from live inventory |

From an **owner number**, text `help`, then try `today`, `stock`, `out ORD-…`, `deliver ORD-…`, and `recurring run` — customers should receive the matching status notifications.

Watch `logs/app.log` while testing — every classification and action is logged with its confidence.

### Enhanced-mode extras

- **Payment**: place an order, pay the Razorpay test link, confirm the order flips to CONFIRMED in the sheet and a calendar event appears. Let a link sit 24h (or cancel it) and confirm stock returns.
- **Voice**: call the Twilio number, speak an order after the beep, expect a WhatsApp follow-up.
- **Languages**: send `أريد 5 وردة` (AR) or `मुझे 5 गुलाब चाहिए` (HI) — replies use the detected language's templates.
- **Webhook security**: `curl -X POST https://<ngrok>/webhook/whatsapp -d "From=+911&Body=hi"` must return **403** (no Twilio signature).

## Accuracy evidence harness (plan Phase 1)

Read-only tools that measure how far the bot's sheet is from Amit's and why.
They never change `src/` behaviour and refuse to open the live
`data/business.db` (or whatever `BUSINESS_DB` points to) — always work on a
copy. Outputs built from real data (`reports/accuracy-baseline*.md`,
`reports/*.csv`, `reports/compare/`) are git-ignored; keep them on this machine.

```powershell
copy data\business.db C:\temp\business-copy.db
# 1. Every group message with IST times and what the pipeline did with it
npx.cmd ts-node scripts/evidence/export-group-messages.ts C:\temp\business-copy.db reports\group-messages.csv
# 2. Row-by-row comparison with Amit's sheets (Downloads and data\amit-sheets by default)
npx.cmd ts-node scripts/compare-del-sheets.ts C:\temp\business-copy.db reports\compare
# 3. Attribute every difference to LATE / MISPARSED / UNPARSED / STUCK_IN_REVIEW / NO_MESSAGE / DATA
npx.cmd ts-node scripts/evidence/accuracy-baseline.ts C:\temp\business-copy.db reports\compare\details.json reports\accuracy-baseline.md
```

`--process-time HH:mm` on step 3 changes the assumed sheet cutoff (default
21:30 IST, `UPDATES_PROCESS_TIME`). The attribution rules are documented at
the top of `scripts/evidence/attribution.ts` and pinned by
`tests/evidenceAttribution.test.ts`.

**Message corpus.** `tests/fixtures/group-message-corpus.json` holds
anonymized staff messages labelled with the plan's taxonomy. Labels are
drafts until `verified` is true. Re-run the probe after any parser change:

```powershell
npx.cmd ts-node scripts/evidence/probe-corpus.ts tests\fixtures\group-message-corpus.json reports\message-probe.md
```

The test suite also runs the corpus through the real pipeline and fails if any
message marked `mustNotMutate` (money, identity, new subscriptions, orders)
changes data on its own.

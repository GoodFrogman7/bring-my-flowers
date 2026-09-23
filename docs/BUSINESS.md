# The Business — Bring My Flowers (Gurgaon)

Domain knowledge captured from the owner's sheet walkthrough (Google Meet, 2026-07-06,
transcribed from Hindi; transcripts in `D:\claude-work\meet\part1-4.txt`) plus analysis
of the three operational workbooks (Master, Delivery Sheet, Feedback).

## Business model

Flower **subscriptions**, delivered on fixed weekdays, zone by zone across Gurgaon.

- **Weekly subscription**: 1 delivery/week. A **cycle = 4 deliveries** (~1 month).
- **Biweekly subscription**: 2 deliveries/week (e.g. Sunday + Thursday, fixed per zone). A cycle = 8 deliveries.
- **Packages** are price tiers with names: Delight ₹999, Bliss ₹1450, Bloom ₹1600 (biweekly), Joy ₹1950, Felicity ₹2300, Elation ₹2750, Charm ₹3000, Corporate ₹4750+, plus Customized variants.
- **Per-delivery revenue** = pack ÷ 4 (weekly) or ÷ 8 (biweekly) — used for the manual daily P&L. Bouquets/corporate arrangements book the full amount.
- **The shop picks the flowers** for normal subscriptions — customers do not order specific flowers. Selection rules: what's in season, what's economical right now, and **never repeat what the customer got in the last ~5 deliveries** (checked via VLOOKUP into the last 5 weeks' feedback sheets). Customers only set **restrictions** (allergies — e.g. lily pollen — or dislikes) and occasional one-off **extra instructions**.
- **Customized package**: customer dictates the exact flowers (e.g. all lilies, every time); priced higher.
- Margin note: gerbera sells at rose-level pack value but costs much less — economical picks raise margin.
- **One-time bouquets** run alongside subscriptions (immediate sale, specific requirements taken).
- **Special Projects**: VIP arrangement clients (e.g. large farmhouse + home accounts, ~₹7k per arrangement, ~₹28k packages, on-call or weekly). Tracked in dedicated Master tabs; no fixed value.

## ID scheme

| Prefix | Meaning |
|--------|---------|
| plain number | Subscriber (lower number = older customer; ID is stable, phone numbers change) |
| B-xxxxx | One-time bouquet — every purchase gets a NEW B number (no history lookup needed) |
| G-xxxxx | Gifted subscription (differentiated to track conversion of giftee) |
| SP | Sample sent to a prospect (rare) |
| CP / Corporate | Corporate account (separated so corporate vs normal revenue can be split) |

## Master workbook (the CRM)

One row per customer-cycle. ~16k rows, 63 columns, "10–11 GB and slow" (owner's words).
Key columns: Active status (Active/Renewed/Hold/Closed/Bouquet), renewal date, advance-payment
markers (customer paying 2+ cycles ahead: start/completion dates, "8" = 8 deliveries paid),
ID, contact, zone, fixed day(s), time slot, pack, per-delivery revenue, package name,
payment type (Paytm/cash — poorly maintained), **payment status** (Completed / Complimentary /
In Process = don't chase (corporates invoiced monthly, gifts) / **Pending** = chase),
Collect (₹ to collect), cycles pending, debit-credit (under/over payment), payment date & amount
(blank until money arrives), **Remarks** (date-stamped instruction history), **Flower Restriction**,
**Extra Instruction** (next-delivery-specific), then the cycle's delivery dates (weekly: +7 days
× 4 with a changed-date column each; biweekly: 8 date slots).

## Pack composition (official card, docs/assets/pack-card.jpeg)

All plans: 4 weeks, one delivery per week. **Deliveries alternate between a
SEASONAL week and a PREMIUM week** — this alternation plus "never repeat the
last 5" plus per-customer restrictions is the flower-assignment rulebook.

| Pack | Price | Seasonal week | Premium week |
|------|-------|---------------|--------------|
| Bliss | ₹1450 | 16 stems | Asiatic Lily/Sunflower ×3 · Spray Daisy/Orchid ×5 |
| Joy | ₹1950 | 22 stems | Asiatic Lily/Sunflower/Eustoma/BOP ×4 · Spray Daisy/Orchid ×7 |
| Elation | ₹2750 | 32 stems | Asiatic/Sunflower/Eustoma/BOP ×6 · Spray Daisy/Orchid ×10 |
| Enchantment | ₹4750 | 60 stems | Asiatic/Sunflower/Eustoma/BOP ×11 · Anthurium/Heliconia ×6 · Oriental Lily ×5 · Spray Daisy/Orchid ×18 |

**Flower classes** — SEASONAL: Rose, Carnation, Guldawari, Gladioli, Tuberose
(Rajni), Gerbera, "and more". PREMIUM: Asiatic Lily, Sunflower, Eustoma, BOP,
Spray Daisy, Orchid, Anthurium, Heliconia, Oriental Lily.

Card covers the flagship packs only; Delight ₹999, Bloom ₹1600 (biweekly),
Felicity ₹2300, Charm ₹3000 etc. exist in the Master — get their recipes from
the owner. Brand promises (docs/assets/brand-flyer.jpeg): 48-hour replacement
policy; skip/hold anytime with one day's notice; customization by phone
(+91 9717173327, bringmyflowers.com).

## Daily operating loop

1. **Customer messages** arrive on the customer-care phone (staffed by Pooja). Operational instructions are forwarded to a WhatsApp group with the manager (Sanjay) — "hold these customers today."
2. Owner manually updates the Master (remarks with date stamps, payment status).
3. **Delivery sheet generation (manual, daily)**: type tomorrow's date into a formula cell → filter due customers (~50–80/day) → copy the needed columns, delete the rest → add 5 VLOOKUP columns showing each customer's **last 5 flowers** from past feedback sheets → manually assign **Flower 1/2/3 + stick counts + consumables** (grass/filler) respecting restrictions, avoiding repeats, preferring cheap/seasonal → Sheet2 computes total sticks per flower, subtracts leftover stock, applies wastage %, and yields the **TO BUY list** with current per-bunch costs.
4. Sheet goes to Sanjay who **builds the route manually** (no routing software — he knows every society/sector; starts nearest the office). Delivery boys are largely fixed per zone/day but cross-trained (any boy can run any route). 5 boys; morning slot (9–2) capacity-limited, evening 4–7.
5. Boys deliver, **collect cash**, bring feedback.
6. **Feedback sheet** (one tab per date) = the delivery sheet + route order + Delivered By + Feedback + cash Payment column. **Feedback values are a fixed set of ~15–16 types** (return, hold, payment received via Paytm, specific flower next week, day change…). Substitutions made mid-day (flower shortage) are recorded here — the feedback sheet is the record of *what was actually sent*.
7. **Payment messages**: Pooja texts customers daily from the sheet, two fixed templates —
   - "Yesterday we sent the 2nd of your 4 deliveries and we have received the payment."
   - "Yesterday we sent the 3rd of your 4 deliveries and we have NOT received the payment. Kindly pay this amount on this number."
   Subscription payment is requested the day after a delivery; bouquets chased ~10 days later.
8. Flower **cost history sheet** (2–3 years of per-flower, per-date purchase prices) is maintained separately (with Sanjay). Prices are demand/supply driven (festivals spike them) — owner says they cannot be predicted from a fixed range.
9. **Biweekly flowers sheet**: separate lookup the manager updates, because the last-5 VLOOKUP misses the second weekly delivery.

## What the owner explicitly asked to automate (part 4 of the call, near-verbatim)

> "Customer messages come in → take the values and update the Master (or a copy of it) with
> whatever instruction came — skip a date, send earlier… update the payment when it comes…
> then generate my delivery sheet — don't repeat the last 5 flowers sent, send the cheapest
> available flower — and make the route. And this delivery sheet…"

So, in priority order:
1. **Message intake** → parse customer WhatsApp instructions (the ~16 fixed types) → auto-update records.
2. **Payment updates** + the daily payment-message run (two fixed templates).
3. **Delivery sheet generation** — due-customer filter, last-5 lookup, flower assignment (cheapest available, no repeats, restrictions), procurement TO BUY.
4. **Route building** per zone.

## Phase A implementation (done)

The datastore + import/export pipeline lives in `src/business/`:

- `db.ts` — SQLite schema: customers → subscriptions → cycles → deliveries,
  one_time_orders, restrictions, delivery_log (what actually shipped, from the
  feedback sheets), flowers + price history.
- `importMaster.ts` — `npm run import:master <Master.xlsx>`; tolerant of the
  real data (serial dates, `//` phone lists, status typos, biweekly date-pair
  encoding where each planned/changed pair holds TWO deliveries).
- `importFeedback.ts` — `npm run import:feedback <Feedback.xlsx>`; one tab per
  date, columns located by header, populates delivery_log.
- `delSheet.ts` — `npm run del-sheet <YYYY-MM-DD>`; regenerates the daily
  delivery sheet in the owner's exact 30-column format, including the
  last-5-flowers lookback (byte-identical to his VLOOKUP output in shadow
  testing). Flower 1-3 assignment stays manual until Phase C.

Shadow-tested against the real 06-July sheet: 72/77 rows reproduced; the
misses are bouquets/subscribers created after the April Master snapshot.

## Phase B implementation (done)

The live-operation layer (`npm run start:business`, or `npm run dev:business`):

- **Instruction intake** (`instructions.ts` + `actions.ts`): deterministic
  parsing of the fixed customer-instruction vocabulary — skip/hold (one
  delivery, N weeks, indefinite), resume, day change, one-off reschedule,
  payment claims, flower restrictions, address changes, status questions,
  cancellation, renewal — English + common Hinglish. Every action updates the
  datastore, appends a date-stamped remark in the owner's format
  ("Hold 1 week (06/07)"), replies to the customer, and alerts staff where a
  human matters. Payment claims are never auto-marked paid — staff verify and
  reply `paid <id>`. Cancellations pause deliveries and demand a call-back.
  Unknown numbers and unparseable messages always escalate; nothing drops.
- **LLM fallback**: Ollama classifies what the regexes miss into the same
  instruction types; anything still unclear goes to a human.
- **Staff ops channel** (message from an `OWNER_NUMBERS` phone): `due`,
  `sheet <date>`, `payrun`, `pending`, `renewals`, `paid/hold/resume/
  restrict/note/find/customer`.
- **Payment run** (`paymentRun.ts`, `npm run payment-run [date]`): the two
  fixed templates Pooja sends daily, generated per delivery, with a renewal
  ask appended when a cycle completes; plus the renewal chase list
  (finished cycles with no new cycle behind them).
- All business dates are computed in IST regardless of server timezone
  (`dates.ts`).

Transport: dashboard by default — paste staff updates into the local owner
console and keep WhatsApp out of the critical path. Set
`BUSINESS_TRANSPORT=baileys` only for the optional existing Updates-group
adapter; `BUSINESS_TRANSPORT=twilio` or `BUSINESS_TRANSPORT=cloud` are separate
webhook deployments.
`BUSINESS_DB` overrides the datastore path.

## Phase C implementation (done)

Flower assignment + procurement (`assignment.ts`) and renewals (`renewal.ts`):

- **Assignment engine**, applied automatically in every generated delivery
  sheet: restrictions are absolute → weeks alternate seasonal/premium (read
  from the customer's last logged delivery) → never repeat the last 5 flowers
  (relaxes to last-2 before giving up; restrictions never relax) → cheapest
  per stem wins. Flowers with unknown cost are never picked. Packs without a
  recipe (Delight/Bloom/Felicity/Charm/Corporate/Customized/bouquets) stay
  manual and are listed on the sheet's Procurement tab — recipes live in the
  `pack_recipes` table, seeded from the card (`scripts/seed-flowers.ts`).
- **Procurement tab** on every delivery sheet: sticks per flower → bunches
  (wastage-inflated, rounded up) → estimated cost. Real 07-July run:
  45 rows, 21 auto-assigned, ₹4,775 TO BUY estimate.
- **Renewals**: a customer texting "renew" (or staff `renew <id>`) creates the
  next cycle — 4 weekly deliveries on the fixed day, or 8 paired biweekly
  (fixed day + 3 days) — payment PENDING with the full pack to collect.
  Stacking is refused while planned deliveries remain.

**Open question for the owner:** the card promises clean seasonal/premium
alternation, but the June logs show he usually sends premium-accent +
seasonal-base combos (e.g. "Sunflower ×3 + Glad ×11"). The engine follows the
card; if he prefers his combo style, the recipes need a second per-week shape.

## Constraints to respect

- The team (Pooja, Sanjay, 5 delivery boys) lives in these sheets. Any system must keep
  producing **Excel artifacts in the current formats** during transition — the sheet IS the UI.
- The Master is the fragile piece (huge, slow, formula-driven). Replace it with a real datastore
  and generate sheet views from it, rather than automating on top of the workbook.
- Feedback/instruction vocabulary is small and fixed — deterministic parsing is feasible;
  the LLM is only a fallback.
- Flower costs are volatile; procurement math needs current prices as input, not assumptions.

## Owner dashboard and smart Q&A (2026-07)

Business mode ships a **local owner console** at `http://localhost:8787` (same
machine as the bot): Home / Deliveries / Money / Review / Ask the bot / Settings.
In the recommended dashboard mode, the Overview tab is the daily intake: paste
the exact staff update, apply it, review exceptions, and download the next sheet.
WhatsApp QR/settings are shown only for the optional legacy adapter.

**Dashboard-first safety rule:** WhatsApp is an input and notification convenience,
not the source of truth. If it is disconnected, the owner can still apply
updates, run the renewal/review engine, and generate the Excel delivery sheet.

**WhatsApp group rules (Updates group only):**

- Every message is read and stored for the nightly parser.
- The bot is a **silent listener** (`GROUP_SILENT=1`, the default): it posts
  nothing to any group — no answers, no sheet, no summary. `Bot, …` calls are
  stored for the record but not answered; ask in the owner console instead.
- Nightly run writes the sheet for the dashboard. Legacy group posting
  (`GROUP_SHEET_SEND`, `GROUP_NIGHTLY_SUMMARY`, `Bot,` replies) only works with
  `GROUP_SILENT=0`.
- Personal chats are ignored. Owner sheet DMs stay off unless `OWNER_SHEET_DM=1`.

**Answer quality (degradation chain, safest first):**

1. **Cloud AI** (`LLM_PROVIDER=anthropic` or `openai` in `.env`) — question is
   refined, then answered using **read-only database tools** (deliveries,
   collections, customer lookup, renewals, review queue). The model cannot
   change orders, subscriptions, or payments.
2. **Local read-only tools** — same queries, no API key; handles “who owes the
   most?”, “how much does X owe?”, “total deliveries today”.
3. **Local Ollama** — snapshot-based answers when Ollama is running.
4. **Deterministic fallback** — keyword patterns.

**Safe testing:** `npm run sandbox` copies production into `sandbox/` and exposes
the same commands plus a sandbox dashboard on port 8788. Production is never
written during sandbox sessions.

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

## Constraints to respect

- The team (Pooja, Sanjay, 5 delivery boys) lives in these sheets. Any system must keep
  producing **Excel artifacts in the current formats** during transition — the sheet IS the UI.
- The Master is the fragile piece (huge, slow, formula-driven). Replace it with a real datastore
  and generate sheet views from it, rather than automating on top of the workbook.
- Feedback/instruction vocabulary is small and fixed — deterministic parsing is feasible;
  the LLM is only a fallback.
- Flower costs are volatile; procurement math needs current prices as input, not assumptions.

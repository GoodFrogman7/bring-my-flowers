# Bring My Flowers — Project Handoff

Checked 2026-09-05. This is the first-principles summary of the product and
the work completed in the current session.

## Problem definition

The product is not primarily a customer chatbot. It is a small operations
system for a Gurgaon flower-subscription business:

```text
Dashboard paste (primary) ─┐
Optional WhatsApp group ───┴→ SQLite business database → tomorrow's Excel sheet
                                                        → local owner dashboard
```

The system should preserve the team's existing habits, keep money-moving and
ambiguous decisions human-controlled, and give the owner one dependable daily
action: open the app, prepare/download tomorrow's sheet, and handle exceptions.

## What the repository history shows

- The early project was a generic WhatsApp chatbot with Excel, Ollama, Twilio,
  Cloud API, Google Sheets, Razorpay, voice, calendar, and inventory paths.
- The July business-mode work changed the source of truth to SQLite, imported
  the owner's Master workbook, added deterministic instruction parsing,
  delivery-sheet generation, feedback history, assignment/procurement, group
  staging, review escalation, and a local owner console.
- Commit `5c5379a` on 2026-08-11 is the last commit on `main`. It fixed the two
  most important data-accuracy issues found by comparing generated sheets with
  the owner's real sheets: automatic subscription continuation and stale flower
  history, plus the IST boundary in the Master import.
- Immediately before this session, a separate cloud-agent handoff existed on
  branch `cursor/cloud-agent-1788578152610-3ihw5` at `86b126f`. It upgraded
  Baileys from 6.7.23 to 6.7.24 and worked on QR/relink reliability, launcher
  restarts, dead QR cleanup, and Baileys init-query failures. It was not merged
  into `main` when this session began; the relevant code changes are now in the
  working tree.

### Last thing worked on before this session

The final pre-session work was WhatsApp reliability: making the Baileys QR and
reconnect loop recover from dead QR references and `init queries` failures,
then teaching the Windows launcher to restart the bot using its health/lock
signals. The dependency was bumped to Baileys 6.7.24. That work addressed the
symptoms; this session changes the product so those symptoms are no longer a
requirement for the uncle's daily workflow.

## Simplified product decision

The uncle release should expose only:

1. Business mode.
2. One dashboard intake: paste a staff update, apply it, and download the sheet.
3. WhatsApp only as an optional legacy adapter for the existing Updates group.
4. SQLite as the source of truth.
5. The generated Excel delivery sheet.
6. The local dashboard for Overview, Deliveries, Money, Review, and Settings.

Customer direct-chat automation, Twilio, Cloud API, Google Sheets, Razorpay,
voice, calendar, and Ollama remain development/optional paths. They should not
be part of the uncle's instructions or daily mental model.

## Current operational facts

- The local database is populated and the business dashboard can calculate
  deliveries, collections, renewals, review items, and sheets.
- WhatsApp is currently not linked in this environment. That no longer blocks
  dashboard-first operations; the recommended transport does not start it.
- The database has a substantial manual-review backlog. This is intentionally
  surfaced rather than silently auto-applied; it should be triaged with the
  owner before treating the system as fully live.
- The imported delivery-history log was last refreshed through the latest
  available archived feedback used by the August 11 accuracy fix. Newer manual
  sheets should be imported before relying on flower-rotation decisions.

## Changes made in this session

- Made Ollama optional in business mode and disabled by default with
  `BUSINESS_USE_OLLAMA=0`.
- Made the setup verifier understand dashboard-first business mode without
  owner numbers, Ollama, or `UPDATES_GROUP_JID`.
- Made setup and release scripts use `npm.cmd`, which works on Windows when the
  PowerShell `npm` shim is blocked by execution policy.
- Replaced fragile Windows process-command inspection with the dashboard health
  endpoint and the app's own lock file.
- Fixed Windows PowerShell 5.1 parsing by removing non-ASCII punctuation from
  the launcher/setup scripts.
- Updated the dashboard language so read-only local data is the default story;
  cloud/local AI is clearly optional.
- Added dashboard-first transport: manual update staging/apply routes, a
  no-op outbound adapter, transport-independent renewal/sheet scheduling, and
  an uncle-facing paste/apply workflow. WhatsApp is now optional in the
  recommended path.
- Added the Baileys 6.7.24 and QR/reconnect reliability fixes from the prior
  handoff.
- Built a clean release bundle at
  `release/BringMyFlowers-Console-20260905.zip`. It contains no `.env`,
  WhatsApp sessions, or production database.

## Verification

- TypeScript build: passed.
- Vitest: 25 files, 344 tests passed.
- Business sandbox smoke test: passed.
- Business setup verification: passed without contacting Ollama.
- Windows PowerShell parser checks: passed for all four launcher/setup scripts.

## Later on 2026-09-05 (second session)

- WhatsApp was relinked after all (`BUSINESS_TRANSPORT=baileys`); the owner
  chose to keep the Updates-group adapter live alongside the dashboard. Two
  further bugs fixed: Baileys' post-connect init queries hung 60 s on every
  connect (now skipped with `fireInitQueries: false`), and a `\'` escape inside
  the console's template literal broke the inline script (console stuck on
  "Loading…").
- The owner console can now be opened from a phone on the same WiFi: setting
  `CONSOLE_PASSWORD` binds 0.0.0.0 and gates every route behind a login.
- Amit's emailed delivery sheets (Jul 8–Aug 21) were compared against the
  bot's output: ~85% row match. Root causes and fixes are described in
  `scripts/compare-del-sheets.ts` and the commit "Delivery-sheet accuracy".
- Vitest: 25 files, 352 tests passed.

## Next live-pilot decision

For the first week, use dashboard-first mode: paste the same staff updates,
apply them explicitly, use Review for anything ambiguous, and export Excel.
Keep the existing WhatsApp group disconnected unless the staff specifically
needs it. The next product decision is whether to add narrowly scoped payment
and hold buttons after the review backlog is understood; do not add broad
AI-driven mutation yet.

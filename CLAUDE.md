# Bring My Flowers — Claude Code Handoff

Start here when working on this repository. This is a small operations system
for a Gurgaon flower-subscription business. Its job is to turn staff updates
into an accurate SQLite-backed delivery plan and tomorrow's Excel sheet. It is
not primarily a customer chatbot.

## Read before changing code

1. `docs/PROJECT-HANDOFF.md` — product history, decisions, and prior-session
   context.
2. `docs/WHATSAPP-STRATEGY.md` — why WhatsApp was removed from the critical
   path and what remains supported.
3. `README.md` and `docs/OWNER-CONSOLE.md` — setup and day-to-day operation.
4. Inspect `git status --short` and recent history before making changes.

Do not treat this file or the older handoff documents as a substitute for
checking the implementation. If documentation and code disagree, verify the
behavior with tests and update the documentation as part of the same change.

## Product decision: dashboard first

The dependable operating path is:

```text
Staff update → paste into local dashboard → explicit Apply → SQLite → Excel sheet
                                                └────────────→ Review when unclear
```

`BUSINESS_TRANSPORT=dashboard` is the recommended default. The uncle should
not need a WhatsApp QR scan, group ID, webhook, tunnel, token, AI service, or
customer-chat automation to prepare the next day's work.

WhatsApp/Baileys is an optional legacy adapter for the existing Updates group.
Keep it isolated and optional. Do not make QR/session reliability a prerequisite
for the dashboard, SQLite, review queue, renewal logic, or sheet generation.

SQLite is the source of truth. The generated `.xlsx` file is the delivery
artifact. The dashboard is the human control surface. Ambiguous messages must
go to Review rather than being guessed or silently mutating money, subscriptions,
or customer identity.

## Repository state at handoff

Verified 2026-09-23:

- Branch: `main`.
- Working tree: clean before this handoff file was added.
- Current HEAD: `45731b1` — delivery-sheet accuracy fixes for bouquet dates,
  biweekly second-day deliveries, cycle continuation, and hold-today collision.
- Previous commit: `97ce773` — owner console on the phone, dashboard-first
  mode, and WhatsApp connection fixes.
- `.env` is ignored and contains local settings. Never print, upload, or commit
  it.
- `data/`, `sessions/`, `logs/`, `backups/`, and `sandbox/` contain local or
  runtime state. Preserve them in the original workspace, but do not include
  them in a handoff archive.

## What was worked on immediately before this handoff

The last focused work before the simplification effort was WhatsApp reliability:
Baileys QR/reconnect recovery, dead-QR cleanup, post-connect init-query failures,
and launcher restart behavior. The dependency was upgraded to Baileys 6.7.24.
The subsequent product decision was to make that adapter optional so those
problems no longer block the uncle's daily workflow.

The broader data-accuracy work in the latest commit fixed automatic subscription
continuation, stale flower-history refresh, IST import boundaries, bouquet dates,
biweekly second-day deliveries, and hold-today collisions. Preserve those rules
when simplifying the UI or transport layer.

## Safe development rules

- Never expose or copy secrets from `.env`, credential files, WhatsApp session
  files, databases, logs, or backups.
- Do not reset, force-checkout, delete, or rewrite user data or Git history.
- Do not stage or commit changes unless the user explicitly asks.
- Prefer small, reversible changes. Keep the parser conservative and explicit.
- Do not reintroduce a required WhatsApp login merely to improve convenience.
- Do not let an LLM silently apply ambiguous payment, subscription, hold, or
  identity changes.
- Preserve the Windows workflow; use `npm.cmd` in PowerShell scripts because
  the PowerShell `npm` shim may be blocked by execution policy.

## Verification commands

Run from the repository root:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test:sandbox
npm.cmd run verify -- --mode=business
```

For dashboard-first business mode, setup verification should pass without
WhatsApp credentials, an owner phone number, an Ollama service, or an
`UPDATES_GROUP_JID`. If changing launchers, also parse-check the PowerShell
files before delivery.

## Claude Code on the web (Linux cloud sessions)

`.claude/hooks/session-start.sh` runs only when `CLAUDE_CODE_REMOTE=true`. It
runs `npm ci`, creates `data/`, copies `config/business.env.template` to `.env`
if missing, seeds an **empty-schema** `data/business.db`, and builds. Use `npm`
instead of `npm.cmd`. The cloud has no production data, so the sandbox smoke
test there proves the pipeline only, not real-data accuracy. PowerShell
launchers cannot be parse-checked in the cloud; do that on Windows.

## First action for a new Claude session

Read the three handoff documents above, inspect the current Git status and
recent commits, then run the verification commands. Report what is true in the
current checkout before proposing changes. If the goal is to help the uncle,
work on the dashboard-first flow and leave WhatsApp as an explicitly optional
migration path.

For packaging this repository for another machine or Claude interface, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\make-claude-handoff.ps1
```

That creates a source-complete, sanitized archive under `release/` without
touching the original runtime data.

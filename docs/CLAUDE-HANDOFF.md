# Transfer to Claude

This repository is prepared to be opened by Claude Code or supplied as a
sanitized source archive to another Claude interface.

## If Claude Code is running on this computer

Open the existing folder directly:

```text
C:\bring_my_flowers
```

Claude Code will see the complete Git history, the current `main` branch, and
the local files. It should read the root `CLAUDE.md` first, then
`docs/PROJECT-HANDOFF.md` and `docs/WHATSAPP-STRATEGY.md`.

The live `.env`, production SQLite data, WhatsApp sessions, logs, backups, and
the machine-local `.claude/settings.local.json` remain in this workspace. They
are intentionally not part of a portable handoff.

## If Claude needs a portable upload

From PowerShell in the project root, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\make-claude-handoff.ps1
```

The script creates a dated folder and ZIP under `release/`. It includes the
source code, tests, documentation, configuration templates, launchers, and
compiled output. It excludes `.env`, `.git`, `.claude`, `data`, `sandbox`,
`sessions`, `logs`, `backups`, `node_modules`, and previous release artifacts.

Excluding `.git` is deliberate: Git history can contain old secrets even when
the current working tree is clean. The product history and the last completed
work are summarized in `docs/PROJECT-HANDOFF.md` and this handoff.

## Suggested first message to Claude

> Read `CLAUDE.md`, `docs/PROJECT-HANDOFF.md`, and
> `docs/WHATSAPP-STRATEGY.md`. Inspect the current tree and recent Git history,
> then run the build, test, sandbox smoke test, and business verification. Do
> not read or expose `.env`, runtime databases, WhatsApp sessions, logs, or
> backups. Confirm the current dashboard-first behavior before making changes.

## Non-negotiable product context

The uncle's daily workflow is dashboard-first: paste the exact staff update,
apply it explicitly, inspect Review when needed, and download tomorrow's sheet.
WhatsApp/Baileys is optional legacy transport. It must not be a dependency of
the database, renewal logic, review queue, or delivery-sheet generation.

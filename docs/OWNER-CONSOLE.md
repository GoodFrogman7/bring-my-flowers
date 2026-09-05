# Owner Console — Client Handoff

Bring My Flowers on a Windows PC: an always-on local owner console for the
flower operation. The recommended mode does not depend on WhatsApp.
**Personal WhatsApp sheet DMs are OFF by default.** Sheets live on the dashboard;
the legacy WhatsApp group is optional.
The business workflow does not require Ollama or any cloud AI key; those are optional fallbacks for unusual questions.

## What you (the deliverer) do

```powershell
cd C:\bring_my_flowers
npm run make:release
```

Copy `release\BringMyFlowers-Console-YYYYMMDD.zip` to USB / Drive.

Optional: fill Anthropic / Claude keys on the owner's machine later in `.env`.

## What the owner does (once)

1. Install **Node.js 18+ LTS** from https://nodejs.org/
2. Unzip the folder anywhere (Desktop is fine — path no longer must be `C:\bring_my_flowers`)
3. Double-click **`Setup.bat`**
4. Leave `BUSINESS_TRANSPORT=dashboard` in `.env` (the default). No group ID,
   QR scan, Ollama, or cloud account is needed.
5. Double-click **Bring My Flowers** on the Desktop

Daily use: Desktop shortcut only. No terminal required.

## Day-to-day

| Need | Where |
|------|--------|
| Tomorrow's sheet | Home → Download, or Deliveries tab |
| Who owes money | Money → Pending payments |
| Unclear updates | Review tab (shows why + what to do) |
| Staff update | Overview → paste exact message → **Apply this update** |
| Ask a question | Ask the bot (Anthropic if configured) |
| WhatsApp status | Optional; it does not block dashboard mode |

The owner does not need to open a terminal after setup. The simple daily loop is:

1. Paste any staff update into Overview and click **Apply this update**.
2. Check **Review** only if the app says something was unclear.
3. Click **Download tomorrow's sheet**.

The nightly job is a backup: it renews eligible subscriptions, flags dormant
ones, and prepares the next sheet even if WhatsApp is off or broken.

### Optional WhatsApp mode

| Event | What happens |
|-------|----------------|
| Nightly job (21:30 IST) | Applies staged updates and writes the next sheet; group posting happens only in legacy Baileys mode |
| Staff says `Bot, …` / `Flower Bot,` / `BMF,` | Bot answers in the group |
| Staff says `Bot, send sheet` | On-demand sheet (applies pending updates first) |
| Personal DMs of the sheet | **Off** (`OWNER_SHEET_DM=0`) |

To keep the existing group, set `BUSINESS_TRANSPORT=baileys` and
`UPDATES_GROUP_JID=<group JID>`, then scan the QR on `/link`. Dashboard paste/apply
still works as a fallback. `OWNER_SHEET_DM=1` re-enables personal sheet DMs (not
recommended). `GROUP_SHEET_SEND=0` stops nightly group uploads.

## Switch business phone later (only if using legacy WhatsApp mode)

1. `Stop-ScheduledTask -TaskName BringMyFlowersBot`
2. On the old phone: Linked Devices → log out this device
3. Start again → scan QR on `/link` or Settings with the new phone
4. Confirm `UPDATES_GROUP_JID` still matches Updates

## Support card (when the owner calls you)

| Banner / symptom | Meaning | Fix |
|------------------|---------|-----|
| WhatsApp not linked | Legacy Baileys mode is selected | Switch to `BUSINESS_TRANSPORT=dashboard`, or open `/link` and scan QR |
| WhatsApp offline | Legacy group adapter is down | Use Overview → paste update; the dashboard still works |
| UPDATES_GROUP_JID missing | Legacy Baileys mode is selected | Add the group JID, or use dashboard mode |
| Port busy | Second copy running | Close other Bring My Flowers / Node processes |
| Sheet download failed | Excel file open / disk | Close the open sheet, retry |

Logs: `logs\launcher.log`, `logs\app.log`

## Files the owner interacts with

| File | Purpose |
|------|---------|
| `Setup.bat` | One-time install |
| `Launch-BMF.bat` / Desktop shortcut | Daily app |
| `.env` | Transport choice + optional Anthropic key |
| `docs/OWNER-CONSOLE.md` | This guide |

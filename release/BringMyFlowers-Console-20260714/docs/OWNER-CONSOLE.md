# Owner Console — Client Handoff

Bring My Flowers on a Windows PC: always-on Updates-group bot + local dashboard.
**Personal WhatsApp sheet DMs are OFF by default.** Sheets live on the dashboard
and in the Updates group.

## What you (the deliverer) do

```powershell
cd C:\bring_my_flowers
npm run make:release
```

Copy `release\BringMyFlowers-Console-YYYYMMDD.zip` to USB / Drive.

Optional: fill Claude keys on uncle's machine later in `.env`.

## What uncle does (once)

1. Install **Node.js 18+ LTS** from https://nodejs.org/
2. Unzip the folder anywhere (Desktop is fine — path no longer must be `C:\bring_my_flowers`)
3. Double-click **`Setup.bat`**
4. Edit `.env` — set **`UPDATES_GROUP_JID`** to the Updates group (`...@g.us`)
5. Double-click **Bring My Flowers** on the Desktop
6. If prompted, open the **Link** page and scan the QR  
   (WhatsApp → Linked Devices → Link a Device)

Daily use: Desktop shortcut only. No terminal required.

## Day-to-day

| Need | Where |
|------|--------|
| Tomorrow's sheet | Home → Download, or Deliveries tab |
| Who owes money | Money → Pending payments |
| Unclear group messages | Review tab (shows why + what to do) |
| Ask a question | Ask the bot (Claude if configured) |
| WhatsApp status | Red/green banner at top of every page |

Nightly: bot posts summary + sheet into the **Updates group**. It does **not** DM uncle.

To re-enable personal DMs (not recommended): set `OWNER_SHEET_DM=1` in `.env` and restart.

## Switch business phone later

1. `Stop-ScheduledTask -TaskName BringMyFlowersBot`
2. Backup/remove `sessions\`
3. Start again → scan QR on `/link` with the new phone
4. Confirm `UPDATES_GROUP_JID` still matches Updates

## Support card (when uncle calls you)

| Banner / symptom | Meaning | Fix |
|------------------|---------|-----|
| WhatsApp not linked | No `sessions/creds.json` | Open `/link`, scan QR |
| WhatsApp offline | Connection dropped | Wait 1–2 min; bot auto-restarts. If stuck, reopen shortcut |
| UPDATES_GROUP_JID missing | `.env` incomplete | Paste group JID |
| Port busy | Second copy running | Close other Bring My Flowers / Node processes |
| Sheet download failed | Excel file open / disk | Close the open sheet, retry |

Logs: `logs\launcher.log`, `logs\app.log`

## Files uncle interacts with

| File | Purpose |
|------|---------|
| `Setup.bat` | One-time install |
| `Launch-BMF.bat` / Desktop shortcut | Daily app |
| `.env` | Group JID + optional Claude key |
| `docs/OWNER-CONSOLE.md` | This guide |

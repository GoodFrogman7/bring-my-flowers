# Owner Console — Client Handoff

Bring My Flowers on a Windows PC: always-on Updates-group bot + local owner console.
**Sheets live only in the app by default.** WhatsApp stays quiet unless staff call the bot.

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
4. Edit `.env` — set **`UPDATES_GROUP_JID`** to the Updates group (`...@g.us`)
5. Double-click **Bring My Flowers** on the Desktop
6. Open **Settings** (or `/link`) and scan the QR  
   (WhatsApp → Linked Devices → Link a Device)

Daily use: Desktop shortcut only. No terminal required.

## Day-to-day

| Need | Where |
|------|--------|
| Tomorrow's sheet | Home → Download, or Deliveries tab |
| Who owes money | Money → Pending payments |
| Unclear group messages | Review tab (shows why + what to do) |
| Ask a question | Ask the bot (Anthropic if configured) |
| How the bot works / QR swap | **Settings** tab |
| WhatsApp status | Banner at top of every page |

### WhatsApp rules (important)

| Event | What happens |
|-------|----------------|
| Nightly job | Applies staged Updates, regenerates sheet **on disk for the app**. No auto file / summary to WhatsApp. |
| Staff says `Bot, …` / `Flower Bot,` / `BMF,` | Bot answers in the group |
| Staff says `Bot, send sheet` | Bot applies pending updates and sends the `.xlsx` to the group |
| Personal DMs of the sheet | Off (`OWNER_SHEET_DM=0`) |

Optional flags (rarely needed): `GROUP_SHEET_SEND=1`, `GROUP_NIGHTLY_SUMMARY=1`, `OWNER_SHEET_DM=1`.

## Switch business phone later

1. Prefer **Settings → Link or replace WhatsApp number** and follow the steps, **or**:
2. `Stop-ScheduledTask -TaskName BringMyFlowersBot`
3. On the old phone: Linked Devices → log out this device
4. Start again → scan QR in Settings / `/link` with the new phone
5. Confirm `UPDATES_GROUP_JID` still matches Updates

## Support card (when the owner calls you)

| Banner / symptom | Meaning | Fix |
|------------------|---------|-----|
| WhatsApp not linked | No `sessions/creds.json` | Settings → scan QR |
| WhatsApp offline | Connection dropped | Wait 1–2 min; bot auto-restarts. If stuck, reopen shortcut |
| UPDATES_GROUP_JID missing | `.env` incomplete | Paste group JID |
| Port busy | Second copy running | Close other Bring My Flowers / Node processes |
| Sheet download failed | Excel file open / disk | Close the open sheet, retry |

Logs: `logs\launcher.log`, `logs\app.log`

## Files the owner interacts with

| File | Purpose |
|------|---------|
| `Setup.bat` | One-time install |
| `Launch-BMF.bat` / Desktop shortcut | Daily app |
| `.env` | Group JID + optional Anthropic key |
| `docs/OWNER-CONSOLE.md` | This guide |

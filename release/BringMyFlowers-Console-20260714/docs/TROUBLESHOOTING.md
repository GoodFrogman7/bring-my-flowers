# Troubleshooting

Check `logs/app.log` first — every classification, action, and error is logged.

```powershell
Get-Content logs/app.log -Tail 100
Select-String -Path logs/app.log -Pattern "error"
```

## Ollama

| Symptom | Fix |
|---------|-----|
| "Ollama not responding" at startup | `ollama serve`, then `ollama pull llama3`. The bot still runs on regex fallback, but replies are canned. |
| Responses slow or timing out | Try a smaller model, raise `ollama.timeout` in `config/settings.json`, check RAM/CPU. |
| Wrong intent detected | Check the confidence in logs; more explicit phrasing ("No delivery today" vs "no") helps. |

## WhatsApp — baileys mode

| Symptom | Fix |
|---------|-----|
| QR code won't appear or scan | Delete `sessions/`, restart, rescan. Ensure WhatsApp Web isn't logged in elsewhere. |
| Keeps disconnecting | Check internet; delete `sessions/` and re-authenticate; wait a few hours if rate limited. |

## WhatsApp — twilio / enhanced modes

| Symptom | Fix |
|---------|-----|
| "Missing required environment variables" at startup | The error lists exactly which `.env` values your mode needs — see `.env.example`. |
| Messages never reach the bot | Is ngrok running? Does the Twilio webhook URL match the current ngrok URL? Did your phone join the sandbox? Inspect requests at http://localhost:4040. |
| Every webhook returns **403** | Signature validation failing: set `WEBHOOK_BASE_URL` to the current ngrok/production URL (it changes on every ngrok restart). For local curl testing only: `TWILIO_VALIDATE_WEBHOOK=false`. |
| Bot receives but replies fail | Sandbox recipients must have joined the sandbox; check Twilio error codes in logs. |

## Payments (enhanced)

| Symptom | Fix |
|---------|-----|
| "Invalid Razorpay webhook signature" / orders never confirm | Set `RAZORPAY_WEBHOOK_SECRET` to the secret from Razorpay Dashboard → Webhooks (not the API key secret), and make sure the webhook URL points at the current ngrok URL. |
| Order stuck in PENDING_PAYMENT after paying | Check the Razorpay dashboard's webhook delivery log; redeliver the event once the URL/secret is fixed. |

## Google Sheets / Calendar (enhanced)

| Symptom | Fix |
|---------|-----|
| Authentication failed | `google-credentials.json` present? Sheets + Calendar APIs enabled? Sheet shared with the service account email as Editor? |

## Excel data (baileys / twilio)

| Symptom | Fix |
|---------|-----|
| "File is locked" / writes fail | Close Excel; the bot retries file locks but can't write while Excel holds the file. |
| Corrupted data | Restore the latest copy from `backups/` (auto-created before each write). |

## Daily summary

| Symptom | Fix |
|---------|-----|
| Not sent at scheduled time | Bot must be running at that time; check `SUMMARY_TIME` / `config/settings.json` timezone; check logs at the scheduled time. |
| Owners don't receive it | `OWNER_NUMBERS` must be comma-separated with country codes (`+91...`). |

## Build / runtime

| Symptom | Fix |
|---------|-----|
| `npm run build` fails | `npm install`, delete `dist/`, rebuild. |
| Port already in use | Something else on `WEBHOOK_PORT` (default 3000) or Ollama's 11434. |
| Rate limit message to customers | Raise `messaging.rateLimitPerMinute` in `config/settings.json`. |

## Emergency recovery

```bash
# Stop the bot (Ctrl+C), back up data
cp data/business_data.xlsx data/business_data.backup.xlsx

npm run clean && npm install && npm run build
npm start   # re-scan QR in baileys mode
```

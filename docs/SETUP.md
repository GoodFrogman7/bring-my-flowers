# Setup Guide

Complete setup for all three modes. Start with the shared steps, then follow the section for your mode.

## Shared prerequisites (all modes)

1. **Node.js 18+** — https://nodejs.org
2. **Ollama** — https://ollama.ai

```bash
# Install dependencies
npm install

# Pull the LLM (about 4GB)
ollama pull llama3
ollama list          # verify

# Optional: smoke-test Ollama integration
npm run test:ollama
```

Create `.env` from the template and set your owner numbers (they receive daily summaries and alerts):

```bash
cp .env.example .env
```

```env
OWNER_NUMBERS=+919876543210,+919876543211
```

Defaults (Ollama endpoint, summary time, rate limits, order confirmation) live in `config/settings.json`; environment variables override them.

The bot still runs if Ollama is down — classification falls back to regex rules and canned replies — but responses are much better with it.

---

## Mode 1: baileys (WhatsApp Web, no accounts needed)

```bash
npm run build
npm start
```

1. A QR code appears in the terminal.
2. On your phone: WhatsApp → Settings → Linked Devices → Link a Device → scan.
3. Wait for "WhatsApp bot connected successfully".

Data is stored in `data/business_data.xlsx` (auto-created, auto-backed-up to `backups/` before each write). Add inventory by editing the Inventory sheet, or seed test data with `npm run add:sample`.

---

## Mode 2: twilio (Twilio WhatsApp API)

### Twilio sandbox (free)

1. Sign up: https://www.twilio.com/try-twilio
2. Console → **Messaging → Try it out → Send a WhatsApp message**. Note the sandbox number (e.g. `+1 415 523 8886`) and send its `join <code>` from your phone.
3. From the Console dashboard copy the **Account SID** and **Auth Token** into `.env`:

```env
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
WEBHOOK_PORT=3000
```

### Expose the webhook with ngrok

```bash
ngrok http 3000
```

Copy the HTTPS URL, then:

1. Twilio Console → **Messaging → Settings → WhatsApp sandbox settings** → "When a message comes in" → `https://<your-ngrok>.ngrok-free.app/webhook/whatsapp`
2. Set the same base URL in `.env` so webhook signature validation works behind the tunnel — **repeat this every time ngrok restarts with a new URL**:

```env
WEBHOOK_BASE_URL=https://<your-ngrok>.ngrok-free.app
```

### Run

```bash
npm run build
npm run start:twilio
```

**Webhook security:** requests to `/webhook/whatsapp` must carry a valid Twilio signature or they are rejected with 403. For local `curl` testing only, set `TWILIO_VALIDATE_WEBHOOK=false` — never in production.

---

## Mode 3: enhanced (Sheets + Razorpay + voice + calendar)

Do the Twilio setup above first, then:

### Google Cloud (5 minutes)

1. Create a project at https://console.cloud.google.com
2. Enable the **Google Sheets API** and **Google Calendar API**.
3. IAM & Admin → Service Accounts → create one, download its JSON key, save as `google-credentials.json` in the project root (or point `GOOGLE_CREDENTIALS_PATH` at it).
4. Create a Google Sheet, copy its ID from the URL (`https://docs.google.com/spreadsheets/d/<ID>/edit`), and **share the sheet with the service account's email** (Editor). The bot creates the Inventory/Orders/FAQ tabs on first run.

```env
GOOGLE_CREDENTIALS_PATH=./google-credentials.json
GOOGLE_SPREADSHEET_ID=<ID>
```

### Razorpay (3 minutes)

1. Sign up at https://razorpay.com and generate **test keys**: Dashboard → Settings → API Keys.
2. Dashboard → Settings → **Webhooks** → add `https://<your-ngrok>.ngrok-free.app/webhook/payment`, subscribe to `payment_link.paid`, `payment_link.expired`, and `payment_link.cancelled`, and set a **webhook secret**.

```env
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...        # from the webhook settings — NOT the key secret
PAYMENT_CALLBACK_URL=https://<your-ngrok>.ngrok-free.app/payment/success
```

Payment webhooks are **rejected until `RAZORPAY_WEBHOOK_SECRET` is set**. Payment links expire after 24 hours; the expiry webhook cancels the unpaid order and returns its stock.

### Voice calls (optional)

Twilio Console → Phone Numbers → your number → Voice → "A call comes in" → `https://<your-ngrok>.ngrok-free.app/webhook/voice` (POST). Transcription uses Whisper; if unavailable the bot asks callers to text instead.

### Run

```bash
npm run build
npm run start:enhanced
```

---

## Running in production

```bash
npm install -g pm2
npm run build
pm2 start dist/index.js --name flower-bot -- enhanced   # or twilio / baileys
pm2 save
pm2 startup
```

## Security notes

- Never commit `.env`, `google-credentials.json`, `sessions/`, or `data/` (all gitignored).
- If a credential ever lands in a file or log, **rotate it** (Twilio: console.twilio.com → Account → API keys & tokens).
- Keep `TWILIO_VALIDATE_WEBHOOK` unset (validation on) and `WEBHOOK_BASE_URL` current in production.

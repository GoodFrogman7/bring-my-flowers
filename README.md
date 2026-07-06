# Bring My Flowers — WhatsApp Chatbot

Automated WhatsApp chatbot for a flower delivery business. It classifies customer messages with a local LLM (Ollama), takes orders through a multi-turn conversation, manages inventory, notifies delivery personnel, and sends owners a daily business summary.

## Deployment modes

One entry point (`src/index.ts`) runs in one of three modes:

| Mode | WhatsApp transport | Storage | Orders | Extras |
|------|--------------------|---------|--------|--------|
| `baileys` (default) | WhatsApp Web, QR login | Excel | Confirmed directly | — |
| `twilio` | Twilio API + webhook | Excel | Confirmed directly | — |
| `enhanced` | Twilio API + webhook | Google Sheets | Razorpay payment link | Voice calls, Google Calendar, inventory alerts, EN/AR/HI/UR |

Select the mode with a CLI argument or the `BOT_MODE` environment variable:

```bash
npm start                  # baileys (default)
npm run start:twilio       # node dist/index.js twilio
npm run start:enhanced     # node dist/index.js enhanced
```

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Install Ollama and pull the model (https://ollama.ai)
ollama pull llama3

# 3. Configure
#    Copy .env.example to .env and fill in what your mode needs
#    (baileys mode needs nothing beyond OWNER_NUMBERS)

# 4. Build and run
npm run build
npm start        # scan the QR code with WhatsApp > Linked Devices
```

For Twilio and enhanced mode setup (Twilio sandbox, ngrok, Google Cloud, Razorpay), see **[docs/SETUP.md](docs/SETUP.md)**.

## What it handles

- **Orders** — "I want 5 roses for tomorrow" starts a conversation that collects flower, quantity, and date across messages, fuzzy-matches against inventory, checks stock, and asks for confirmation. In enhanced mode the customer gets a Razorpay payment link (24h expiry; unpaid orders are cancelled and stock returned).
- **Cancellations** — "No delivery today" cancels the customer's upcoming order, returns stock, and notifies the delivery person.
- **Reschedules** — "Deliver on Monday instead" moves the upcoming order.
- **Inquiries** — "Do you have lilies?" answered from live inventory.
- **Daily summary** — revenue, costs, profit, and stock report sent to owners at the configured time.

## Project structure

```
src/
├── index.ts                 # Single entry point (mode selection + wiring)
├── server.ts                # Webhook server (voice/payment routes optional)
├── bot/                     # Transports: Baileys, Twilio (MessageSender contract)
├── llm/ollama.ts            # Classification, extraction, response generation
├── conversation/            # Multi-turn order session state
├── handlers/                # Message routing, order fulfillment strategies
├── data/                    # DataStore contract: ExcelManager, GoogleSheetsManager
├── payment/                 # Razorpay client (links, webhook signatures)
├── notifications/           # Delivery-person and customer notifications
├── summary/                 # Daily summary scheduler
├── inventory/               # Low-stock monitor (enhanced)
├── voice/                   # Whisper transcription (enhanced)
├── calendar/                # Google Calendar events (enhanced)
├── i18n/                    # Language detection + translated templates
└── utils/                   # Config, logging, fuzzy match, Twilio signatures
```

## Configuration

Defaults live in `config/settings.json`; `.env` overrides them and holds credentials. See [.env.example](.env.example) for every variable and which mode needs it.

## Development

```bash
npm run dev              # ts-node, baileys mode (dev:twilio / dev:enhanced for others)
npm run build            # compile to dist/
npm test                 # Vitest suite (LLM mocked — no Ollama needed)
npm run test:ollama      # live Ollama smoke test
npm run add:sample       # seed sample Excel data
```

More docs: [docs/SETUP.md](docs/SETUP.md) · [docs/TESTING.md](docs/TESTING.md) · [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Known limitations

- One flower type per order (multi-item orders are planned).
- Enhanced mode reserves stock when the payment link is created; the link's 24h expiry webhook returns it.
- Google Sheets mode does not track per-delivery-person assignments (delivery methods are no-ops).

## License

MIT

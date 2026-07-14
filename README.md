# Bring My Flowers — WhatsApp Chatbot

Automated WhatsApp chatbot for a flower delivery business. It classifies customer messages with a local LLM (Ollama), takes orders through a multi-turn conversation, manages inventory, notifies delivery personnel, and sends owners a daily business summary.

## Deployment modes

One entry point (`src/index.ts`) runs in one of five modes:

| Mode | WhatsApp transport | Storage | Orders | Extras |
|------|--------------------|---------|--------|--------|
| `baileys` (default) | WhatsApp Web, QR login | Excel | Confirmed directly | — |
| `twilio` | Twilio API + webhook | Excel | Confirmed directly | — |
| `cloud` | WhatsApp Business Cloud API + webhook | Excel | Confirmed directly | Template messages outside the 24-hour service window |
| `enhanced` | Twilio API + webhook | Google Sheets | Razorpay payment link | Voice calls, Google Calendar, inventory alerts, EN/AR/HI/UR |
| `business` | WhatsApp Web, Twilio, or Cloud API | SQLite | Subscription operation | The real flower-subscription business: instruction intake, delivery sheets, payment runs — see [docs/BUSINESS.md](docs/BUSINESS.md) |

Select the mode with a CLI argument or the `BOT_MODE` environment variable:

```bash
npm start                  # baileys (default)
npm run start:twilio       # node dist/index.js twilio
npm run start:cloud        # node dist/index.js cloud
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

For Twilio, Cloud API, and enhanced mode setup (webhooks, Google Cloud, Razorpay), see **[docs/SETUP.md](docs/SETUP.md)**.

## What it handles

- **Orders** — "5 roses and 3 lilies for tomorrow" starts a conversation that collects each flower, its quantity, and the date across messages, fuzzy-matches against inventory, checks stock per line, and asks for confirmation with an itemized summary. In enhanced mode the customer gets a Razorpay payment link (24h expiry; unpaid orders are cancelled and stock returned per item).
- **Subscriptions** — "10 roses every Monday" (or a multi-flower bouquet) creates a recurring order. Each morning the bot materializes due subscriptions into real orders (with a fresh payment link per cycle in enhanced mode), skipping and alerting owners when any line is short on stock. Customers can pause, resume, or cancel by message.
- **Cancellations** — "No delivery today" cancels the customer's upcoming order, returns stock, and notifies the delivery person.
- **Reschedules** — "Deliver on Monday instead" moves the upcoming order.
- **Inquiries** — "Do you have lilies?" answered from live inventory.
- **Status notifications** — customers are told when their order goes out for delivery and when it arrives, plus a morning reminder on delivery day, in their own language.
- **Daily summary** — revenue, costs, profit, and stock report sent to owners at the configured time.

## Owner command channel

Messages from `OWNER_NUMBERS` never enter the customer flow — they get a deterministic command channel instead (text `help` for the full list):

```
today · orders tomorrow · order ORD-…       order lookups
out ORD-… · deliver ORD-… · cancel ORD-…    status changes (customer notified)
stock · stock add Roses 50 · stock set …     inventory
recurring · recurring pause|resume|cancel    subscriptions
recurring run · summary                      run schedulers now
```

## Project structure

```
src/
├── index.ts                 # Single entry point (mode selection + wiring)
├── server.ts                # Webhook server (voice/payment routes optional)
├── bot/                     # Transports: Baileys, Twilio (MessageSender contract)
├── llm/ollama.ts            # Classification, extraction, response generation
├── conversation/            # Multi-turn order session state
├── handlers/                # Message routing, owner commands, fulfillment strategies
├── scheduler/               # Recurring-order materialization + delivery reminders
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

- Enhanced mode reserves stock when the payment link is created; the link's 24h expiry webhook returns it.
- Google Sheets mode does not track per-delivery-person assignments (delivery methods are no-ops).

## License

MIT

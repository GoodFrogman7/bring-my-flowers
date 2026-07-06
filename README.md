# Bring My Flowers - WhatsApp Chatbot Automation

Fully automated WhatsApp chatbot for flower delivery business that handles customer messages, manages inventory, notifies delivery personnel, and generates daily business summaries.

## Features

- 🤖 **Automated Customer Service**: Handle messages like "no delivery today" automatically
- 📦 **Inventory Management**: Track stock and update automatically on order changes
- 🚚 **Delivery Notifications**: Auto-notify delivery boys about cancellations and changes
- 📊 **Daily Reports**: Generate end-of-day summaries with profits, losses, and stock levels
- 💾 **Excel Integration**: Store all data in Excel for easy access and backup
- 🔄 **Auto-Reconnect**: Reliable WhatsApp connection with automatic reconnection

## Prerequisites

1. **Node.js 18+** - [Download](https://nodejs.org/)
2. **Ollama** - [Install Ollama](https://ollama.ai/)
3. **WhatsApp Account** - Personal phone number to link as bot

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Ollama

```bash
# Pull the llama3 model
ollama pull llama3

# Verify it's running
ollama list
```

### 3. Configure the Bot

Edit `config/settings.json` and `.env` file:

```bash
# Add owner phone numbers (with country code)
OWNER_NUMBERS=+919876543210,+919876543211
```

### 4. Build and Run

```bash
# Build TypeScript
npm run build

# Start the bot
npm start
```

### 5. Authenticate WhatsApp

- A QR code will appear in the terminal
- Open WhatsApp on your phone
- Go to Settings > Linked Devices > Link a Device
- Scan the QR code

## Project Structure

```
bring-my-flowers/
├── src/
│   ├── bot/
│   │   └── whatsapp.ts          # Baileys WhatsApp bot
│   ├── llm/
│   │   └── ollama.ts            # Ollama integration
│   ├── data/
│   │   └── excelManager.ts      # Excel CRUD operations
│   ├── handlers/
│   │   ├── messageHandler.ts   # Message routing
│   │   └── actions/             # Action handlers
│   ├── notifications/
│   │   └── deliveryNotifier.ts  # Delivery boy notifications
│   ├── summary/
│   │   └── dailySummary.ts      # Daily report generator
│   ├── utils/
│   │   ├── config.ts            # Configuration loader
│   │   └── logger.ts            # Logging utility
│   ├── types/
│   │   └── index.ts             # TypeScript types
│   └── index.ts                 # Main entry point
├── config/
│   └── settings.json            # Bot configuration
├── data/
│   └── business_data.xlsx       # Auto-created data file
├── sessions/                    # WhatsApp session data
├── backups/                     # Auto-backups of Excel
└── logs/                        # Application logs

```

## How It Works

### Customer Cancellation Flow

1. Customer sends: "No delivery today please"
2. Bot receives message → Ollama classifies intent
3. Excel updated: Order status → "CANCELED"
4. Inventory updated: Items added back to stock
5. Delivery boy notified via WhatsApp
6. Customer receives confirmation

### Daily Summary Flow

1. Cron job triggers at 10 PM (configurable)
2. Reads all today's orders from Excel
3. Calculates revenue, costs, profit, inventory changes
4. Ollama generates natural language summary
5. Summary sent to business owners via WhatsApp

## Configuration

### config/settings.json

```json
{
  "ollama": {
    "endpoint": "http://localhost:11434",
    "model": "llama3"
  },
  "scheduler": {
    "summaryTime": "22:00"
  }
}
```

### Environment Variables

See `.env.example` for all available options.

## Usage Examples

### Customer Messages Handled

- ❌ **Cancellations**: "No delivery today", "Cancel my order", "Don't deliver"
- 🔄 **Reschedule**: "Deliver tomorrow instead", "Change delivery to Monday"
- ❓ **Inquiries**: "What's my order status?", "Do you have roses?"

### Daily Summary Example

```
📊 Daily Business Summary - Jan 3, 2026

Orders: 25 total (22 delivered, 3 canceled)
Revenue: ₹12,500
Costs: ₹7,800
Profit: ₹4,700 💰

Inventory Used:
- Roses: 40 stems
- Lilies: 25 stems

Remaining Stock:
- Roses: 60 stems
- Lilies: 35 stems

Notes: Peak sales today! Consider increasing rose stock.
```

## Troubleshooting

### Bot won't connect to WhatsApp
- Delete `sessions/` folder and re-scan QR code
- Make sure WhatsApp Web is not logged in elsewhere

### Ollama not responding
- Verify Ollama is running: `ollama list`
- Check endpoint in config: `http://localhost:11434`

### Excel file errors
- Check file permissions in `data/` folder
- Review `backups/` for recent copies

## Safety Features

- ✅ Message confirmation before actions
- ✅ Auto-backup before Excel updates
- ✅ Comprehensive error logging
- ✅ Auto-reconnect on disconnection
- ✅ Rate limiting to prevent spam
- ✅ Audit trail of all actions

## Development

```bash
# Development mode with auto-reload
npm run dev

# Build TypeScript
npm run build

# Watch mode
npm run watch
```

## License

MIT

## Support

For issues or questions, check the logs in `logs/` folder or review the audit trail.


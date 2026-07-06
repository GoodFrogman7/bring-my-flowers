# Setup Guide - Bring My Flowers WhatsApp Chatbot

This guide will help you set up and run the automated WhatsApp chatbot for your flower delivery business.

## Prerequisites

Before starting, make sure you have:

1. **Windows 10/11** (you're running win32)
2. **Node.js 18 or higher** - [Download here](https://nodejs.org/)
3. **A WhatsApp account** - Personal phone number to use as bot
4. **Ollama** - Local LLM runtime

## Step 1: Install Ollama

### Download and Install

1. Visit [https://ollama.ai/](https://ollama.ai/)
2. Download Ollama for Windows
3. Run the installer
4. Open Command Prompt or PowerShell and verify installation:

```bash
ollama --version
```

### Pull the LLM Model

```bash
ollama pull llama3
```

This will download the Llama 3 model (about 4GB). Wait for it to complete.

### Verify Ollama is Running

```bash
ollama list
```

You should see `llama3` in the list.

## Step 2: Install Project Dependencies

Open PowerShell in the project directory:

```bash
npm install
```

This will install all required packages.

## Step 3: Configure the Bot

### Edit Configuration File

Open `config/settings.json` and verify/update:

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

### Set Owner Phone Numbers

Edit `.env` file (or create it from `.env.example`):

```env
# Add your and your aunt/uncle's phone numbers with country code
OWNER_NUMBERS=+919876543210,+919876543211

# Adjust other settings as needed
SUMMARY_TIME=22:00
```

**Important**: Replace the phone numbers with actual numbers that should receive daily summaries.

## Step 4: Test Ollama Connection

Before running the bot, test if Ollama is working:

```bash
npm run test:ollama
```

This will:
- Check Ollama health
- Test message classification
- Test daily summary generation

If all tests pass, you're ready to proceed!

## Step 5: Add Sample Data (Optional)

For testing, you can add sample orders:

```bash
npm run add:sample
```

This creates sample orders in the Excel file.

## Step 6: Build the Project

Compile TypeScript to JavaScript:

```bash
npm run build
```

## Step 7: Start the Bot

```bash
npm start
```

### First Run: WhatsApp Authentication

When you run the bot for the first time:

1. A **QR code** will appear in the terminal
2. Open WhatsApp on your phone
3. Go to **Settings** → **Linked Devices** → **Link a Device**
4. Scan the QR code
5. Wait for "WhatsApp connection established successfully! 🎉"

The bot will stay connected even after closing WhatsApp on your phone.

## Step 8: Test the Bot

### Send Test Messages

From a phone number with an order in the system, send:

1. **Cancel delivery**: "No delivery today"
2. **Reschedule**: "Deliver tomorrow instead"
3. **Check status**: "What is my order status?"

The bot should respond automatically!

### Check Logs

Logs are saved in the `logs/` folder:
- `app.log` - General application logs
- `audit.log` - All actions taken by the bot

### Check Data

Open `data/business_data.xlsx` to see:
- Orders and their status
- Inventory levels
- Deliveries
- Daily logs

## Daily Summary

Every day at 10 PM (configurable), the bot will:

1. Calculate the day's business metrics
2. Generate a natural language summary
3. Send it to all owner phone numbers

## Troubleshooting

### QR Code Won't Scan

- Delete the `sessions/` folder
- Restart the bot
- Try scanning again

### Ollama Not Responding

```bash
# Check if Ollama is running
ollama list

# If not, start it
ollama serve

# Verify the model
ollama pull llama3
```

### Bot Disconnects Frequently

- Check your internet connection
- Ensure WhatsApp Web is not logged in elsewhere
- Check the `logs/` folder for error messages

### Excel File Errors

- Make sure you have write permissions in the `data/` folder
- Check `backups/` folder for recent backups
- Close Excel if the file is open

## File Structure

```
bring-my-flowers/
├── data/
│   └── business_data.xlsx    ← All your data
├── sessions/                 ← WhatsApp session (keep private!)
├── backups/                  ← Auto backups
├── logs/                     ← Application logs
├── config/
│   └── settings.json         ← Configuration
├── .env                      ← Environment variables
└── src/                      ← Source code
```

## Security Notes

⚠️ **Keep Private**:
- `sessions/` folder (WhatsApp credentials)
- `.env` file (phone numbers)
- `data/` folder (business data)

Add these to `.gitignore` (already configured).

## Running in Production

For 24/7 operation:

### Option 1: PM2 (Recommended)

```bash
npm install -g pm2
npm run build
pm2 start dist/index.js --name flower-bot
pm2 save
pm2 startup
```

### Option 2: Windows Service

Use tools like [NSSM](https://nssm.cc/) to run as a Windows service.

## Maintenance

### Daily Backups

Excel files are automatically backed up before each write. Find them in `backups/`.

### Viewing Logs

```bash
# View recent logs
Get-Content logs/app.log -Tail 50

# View audit trail
Get-Content logs/audit.log -Tail 50
```

### Updating Inventory

Edit `data/business_data.xlsx` → **Inventory** sheet to add/update items.

### Stopping the Bot

Press `Ctrl+C` in the terminal to gracefully shut down.

## Support

Check logs in `logs/` folder for detailed error messages and troubleshooting.

## Next Steps

1. ✅ Add real customer orders to Excel
2. ✅ Add delivery boy phone numbers
3. ✅ Configure owner numbers for daily summaries
4. ✅ Test cancellation flow with real messages
5. ✅ Monitor daily summary at scheduled time

Enjoy your automated flower delivery business! 🌸


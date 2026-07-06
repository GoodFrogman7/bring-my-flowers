# Quick Start Guide

Get your WhatsApp chatbot running in 5 minutes!

## Prerequisites Check

```bash
# Check Node.js version (need 18+)
node --version

# Check if Ollama is installed
ollama --version
```

## 1. Install Ollama Model

```bash
ollama pull llama3
```

## 2. Install Dependencies

```bash
npm install
```

## 3. Configure Owner Numbers

Edit `.env` file:

```env
OWNER_NUMBERS=+919876543210,+919876543211
```

Replace with your phone numbers (include country code).

## 4. Test Ollama

```bash
npm run test:ollama
```

Should show "✅ All tests completed!"

## 5. Build Project

```bash
npm run build
```

## 6. Start Bot

```bash
npm start
```

## 7. Scan QR Code

1. QR code appears in terminal
2. Open WhatsApp → Settings → Linked Devices → Link a Device
3. Scan the QR code
4. Wait for "WhatsApp connection established successfully! 🎉"

## 8. Test It!

Send from a test number:
- "No delivery today"
- "What is my order status?"

Bot should respond automatically!

## Daily Summary

At 10 PM daily, owners receive automatic business summary via WhatsApp.

## Need Help?

See [SETUP.md](SETUP.md) for detailed setup or [README.md](README.md) for full documentation.

## Common Issues

**QR won't scan**: Delete `sessions/` folder and restart

**Ollama error**: Run `ollama serve` in another terminal

**Build fails**: Run `npm install` again

---

🌸 **You're all set!** The bot will now handle customer messages automatically.


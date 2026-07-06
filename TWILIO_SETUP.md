# 5-Minute Twilio WhatsApp Setup

Get your chatbot working on WhatsApp RIGHT NOW with Twilio's **FREE trial** ($15 credit)!

## Step 1: Sign Up for Twilio (2 minutes)

1. Go to: https://www.twilio.com/try-twilio
2. Sign up (free - no credit card for sandbox testing)
3. Verify your phone number

## Step 2: Get WhatsApp Sandbox (1 minute)

1. In Twilio Console, go to: **Messaging** → **Try it out** → **Send a WhatsApp message**
2. You'll see a sandbox number like: **+1 415 523 8886**
3. Send the JOIN code from your phone to activate
   - Example: Send "join <your-code>" to the Twilio number

## Step 3: Get Your Credentials (1 minute)

From Twilio Console dashboard, copy:
- **Account SID** (starts with AC...)
- **Auth Token** (click to reveal)

## Step 4: Configure Bot (1 minute)

Create/edit `.env` file in your project:

```env
# Twilio Credentials
TWILIO_ACCOUNT_SID=AC...your_account_sid...
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Webhook Port
WEBHOOK_PORT=3000

# Owner Numbers (for daily summaries)
OWNER_NUMBERS=+919876543210

# Other settings (keep as is)
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=llama3
EXCEL_FILE_PATH=./data/business_data.xlsx
SUMMARY_TIME=22:00
SESSION_PATH=./sessions
BACKUP_PATH=./backups
LOG_LEVEL=info
```

## Step 5: Expose Webhook with ngrok (Free)

1. Download ngrok: https://ngrok.com/download
2. Run in a new terminal:
   ```bash
   ngrok http 3000
   ```
3. Copy the HTTPS URL (like: https://abc123.ngrok.io)

## Step 6: Configure Twilio Webhook

1. In Twilio Console: **Messaging** → **Settings** → **WhatsApp sandbox settings**
2. Set "When a message comes in" to: `https://your-ngrok-url.ngrok.io/webhook/whatsapp`
3. Click Save

## Step 7: Start the Bot!

```bash
npm run start:twilio
```

You should see:
```
🎉 Bring My Flowers Chatbot (Twilio) is fully operational!
📱 Twilio WhatsApp: Ready
🌐 Webhook: http://localhost:3000/webhook/whatsapp
```

## Step 8: Test It! 🎉

From your phone (that joined the sandbox), send to the Twilio number:

1. **"No delivery today"** - Should cancel an order
2. **"What is my order status?"** - Should get info
3. **"Deliver tomorrow instead"** - Should reschedule

Watch the logs in the terminal to see the bot processing messages in real-time!

## Test Numbers in System

These test customers are already in Excel:
- **Rajesh Kumar**: +919876543210 (10 Roses)
- **Priya Sharma**: +919876543211 (5 Lilies)
- **Anita Desai**: +919876543212 (8 Tulips)
- **Vikram Singh**: +919876543213 (15 Roses)

## Troubleshooting

**"Missing Twilio credentials" error?**
- Make sure .env file exists and has TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER

**Messages not arriving?**
- Check ngrok is running
- Verify webhook URL in Twilio console
- Make sure you joined the sandbox

**Webhook not receiving messages?**
- Check ngrok URL is public and HTTPS
- Verify webhook endpoint in Twilio matches ngrok URL
- Look at ngrok web interface (http://localhost:4040) for requests

## Cost

- **Sandbox**: Completely FREE for testing
- **Production**: ~$0.005 per message (half a cent)
- **Free Trial**: $15 credit (3,000 messages!)

## Going to Production

When ready for real customers:
1. Request WhatsApp Business Profile approval (takes 1-2 days)
2. Update phone number in config
3. Remove sandbox restrictions

That's it! Your bot is now live on WhatsApp! 🌸


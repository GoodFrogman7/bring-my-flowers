# Enhanced Flower Delivery Automation - Setup Guide

## 🎯 New Features

✅ Google Sheets integration (replaces Excel)
✅ AI-powered order placement with natural language
✅ Razorpay payment integration
✅ Voice call handling with AI transcription
✅ Google Calendar auto-scheduling
✅ Smart inventory alerts (20% threshold)
✅ Multi-language support (English, Arabic, Hindi, Urdu)

---

## 📋 Prerequisites

1. **Node.js 18+** - Already installed ✓
2. **Ollama with llama3** - Already running ✓
3. **Twilio Account** - Already configured ✓
4. **ngrok** - Already configured ✓
5. **NEW: Google Cloud Project**
6. **NEW: Razorpay Account**

---

## 🔧 Setup Steps

### Step 1: Google Cloud Setup (5 minutes)

1. **Create Google Cloud Project**
   - Go to: https://console.cloud.google.com
   - Create new project: "BringMyFlowers"

2. **Enable APIs**
   - Enable Google Sheets API
   - Enable Google Calendar API

3. **Create Service Account**
   - Go to: IAM & Admin → Service Accounts
   - Create service account: "flower-bot"
   - Download JSON key file
   - Save as: `google-credentials.json` in project root

4. **Create Google Sheet**
   - Go to: https://sheets.google.com
   - Create new spreadsheet: "Bring My Flowers Data"
   - Copy the Spreadsheet ID from URL:
     ```
     https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
     ```
   - Share the sheet with service account email (from JSON file)
     - Give "Editor" permission

### Step 2: Razorpay Setup (3 minutes)

1. **Sign up for Razorpay**
   - Go to: https://razorpay.com
   - Create account (Free for testing)

2. **Get API Keys**
   - Dashboard → Settings → API Keys
   - Generate Test Keys
   - Copy Key ID and Key Secret

3. **Enable WhatsApp Notifications**
   - Dashboard → Settings → Webhooks
   - We'll set this up later

### Step 3: Configure Environment Variables

Create/update `.env` file:

```env
# Twilio (Already configured)
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Google Sheets & Calendar
GOOGLE_CREDENTIALS_PATH=./google-credentials.json
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id_here

# Razorpay
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your_secret_here

# Payment Callback
PAYMENT_CALLBACK_URL=https://your-ngrok-url.ngrok-free.dev/payment/success

# Owner Numbers (for alerts)
OWNER_NUMBERS=+96567091345

# Webhook Port
WEBHOOK_PORT=3000

# Ollama
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=llama3

# Other settings
SUMMARY_TIME=22:00
LOG_LEVEL=info
```

### Step 4: Install Dependencies

```bash
npm install
```

New packages added:
- `googleapis` - Google Sheets & Calendar
- `razorpay` - Payment processing
- `openai-whisper` - Voice transcription (optional)

### Step 5: Build the Project

```bash
npm run build
```

### Step 6: Start the Enhanced Bot

```bash
npm run start:enhanced
```

You should see:

```
🎉 Enhanced Bring My Flowers Chatbot is fully operational!
=====================================================
📱 Twilio WhatsApp: Ready
🌐 Webhook: http://localhost:3000/webhook/whatsapp
🎤 Voice: http://localhost:3000/webhook/voice
💳 Payment: http://localhost:3000/webhook/payment
📊 Google Sheets: Connected
📅 Google Calendar: Connected
💰 Razorpay: Connected
🌍 Languages: EN, AR, HI, UR
📦 Inventory Monitor: Running
📊 Daily Summary: Scheduled at 22:00
=====================================================
```

### Step 7: Configure Webhooks

#### A. ngrok (if not running)

```bash
ngrok http 3000
```

Copy the HTTPS URL.

#### B. Twilio Webhooks

1. **WhatsApp Messages**:
   - URL: `https://your-ngrok.ngrok-free.dev/webhook/whatsapp`
   
2. **Voice Calls**:
   - Go to: Twilio Console → Phone Numbers → Your Number
   - Voice & Fax → A CALL COMES IN
   - Webhook: `https://your-ngrok.ngrok-free.dev/webhook/voice`
   - Method: POST

#### C. Razorpay Webhooks

1. Go to: Razorpay Dashboard → Settings → Webhooks
2. Add webhook: `https://your-ngrok.ngrok-free.dev/webhook/payment`
3. Events: Select "payment_link.paid"
4. Secret: (auto-generated, not needed for Razorpay)

---

## 🧪 Testing the New Features

### Test 1: AI-Powered Order Placement

Send via WhatsApp:

```
I want to order 50 red roses and 30 white lilies for tomorrow
```

**Expected Flow**:
1. ✅ Bot extracts order details using AI
2. ✅ Checks inventory availability
3. ✅ Calculates total price
4. ✅ Creates Razorpay payment link
5. ✅ Sends link via WhatsApp
6. ✅ Customer pays
7. ✅ Order confirmed in Google Sheets
8. ✅ Calendar event created
9. ✅ Confirmation sent

### Test 2: Voice Call Orders

1. Call the Twilio number
2. After beep, say: "I want 100 roses for my wedding"
3. Bot transcribes and processes
4. Payment link sent via WhatsApp

### Test 3: Multi-Language

**Arabic**:
```
أريد 50 وردة حمراء
```

**Hindi**:
```
मुझे 50 लाल गुलाब चाहिए
```

**Urdu**:
```
مجھے 50 سرخ گلاب چاہیے
```

Bot should detect language and respond accordingly!

### Test 4: Inventory Alerts

The bot checks inventory every hour. To force check:
- Low stock items (below 20%) trigger alerts
- Owners get WhatsApp message
- Calendar event created

### Test 5: Payment Flow

1. Order something via WhatsApp
2. Click payment link
3. Pay using UPI/Card
4. Watch order get confirmed automatically
5. Check Google Sheets - order updated
6. Check Google Calendar - event created

---

## 📊 Google Sheets Structure

The bot auto-creates these sheets:

### **Inventory Sheet**
| flower_name | quantity | unit_price | cost_price | max_stock | last_updated | language_names |
|-------------|----------|------------|------------|-----------|--------------|----------------|
| Roses       | 100      | 50         | 30         | 200       | 2026-01-02   | Roses\|ورد\|गुलाब\|گلاب |

### **Orders Sheet**
| order_id | customer_name | customer_phone | items | quantity | total_amount | payment_status | payment_id | order_date | delivery_date | delivery_boy | status | notes | language |
|----------|---------------|----------------|-------|----------|--------------|----------------|------------|------------|---------------|--------------|--------|-------|----------|
| ORD-001  | Ahmed         | +96567091345   | Roses | 50       | 2500         | PAID           | pay_xyz    | 2026-01-02 | 2026-01-03    | Ali          | CONFIRMED | | en |

### **FAQ Sheet**
| question_en | answer_en | question_ar | answer_ar | question_hi | answer_hi | question_ur | answer_ur | category | keywords |
|-------------|-----------|-------------|-----------|-------------|-----------|-------------|-----------|----------|----------|
| What flowers? | We have... | ما هي الزهور؟ | لدينا... | कौन से फूल? | हमारे पास... | کون سے پھول? | ہمارے پاس... | inventory | flowers,stock |

---

## 🎯 Key Differences from Basic Version

| Feature | Basic Version | Enhanced Version |
|---------|---------------|------------------|
| **Storage** | Excel (local) | Google Sheets (cloud) |
| **Order Creation** | Manual only | AI-powered from text/voice |
| **Payment** | None | Razorpay integration |
| **Voice** | Not supported | Full voice call handling |
| **Languages** | English only | EN + AR + HI + UR |
| **Calendar** | None | Google Calendar sync |
| **Inventory** | Manual check | Auto-alerts at 20% |

---

## 🔍 Troubleshooting

### Google Sheets Error

**Error**: "Google Sheets authentication failed"

**Fix**:
1. Check `google-credentials.json` exists
2. Verify service account email
3. Ensure sheet is shared with service account
4. Check API is enabled in Google Cloud

### Razorpay Webhook Not Working

**Fix**:
1. Verify ngrok is running
2. Check webhook URL in Razorpay dashboard
3. Test with Razorpay webhook tester
4. Check logs: `logs/app.log`

### Voice Not Working

**Fix**:
1. Whisper might not be installed
2. Bot will use fallback (asks to text instead)
3. To install Whisper: `pip install openai-whisper`

### Multi-Language Issues

**Fix**:
- Ollama handles translation
- If Ollama is slow, bot uses templates
- All 4 languages work out of the box

---

## 💡 Pro Tips

1. **First Orders**: Send a test order in each language to populate sheets
2. **Inventory**: Add more flowers in Google Sheets directly
3. **FAQ**: Add common questions in FAQ sheet for faster responses
4. **Payment Testing**: Use Razorpay test mode first
5. **Voice Calls**: Train Whisper model for better accuracy
6. **Calendar**: Share calendar with delivery boys' emails

---

## 🚀 You're Ready!

The enhanced system is now:
- ✅ Processing orders in 4 languages
- ✅ Accepting payments automatically
- ✅ Handling voice calls
- ✅ Syncing with Google Calendar
- ✅ Monitoring inventory 24/7
- ✅ Storing everything in cloud (Google Sheets)

**Start testing with real orders!** 🌸

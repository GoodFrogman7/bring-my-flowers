# 🚀 Quick Start - Enhanced Version

## ⚡ Get Started in 15 Minutes

---

## Step 1: Google Cloud (5 min)

### 1.1 Create Project
```
1. Go to: https://console.cloud.google.com
2. Click "New Project"
3. Name: "BringMyFlowers"
4. Click "Create"
```

### 1.2 Enable APIs
```
1. In search bar, type "Google Sheets API"
2. Click "Enable"
3. Repeat for "Google Calendar API"
```

### 1.3 Create Service Account
```
1. Menu → IAM & Admin → Service Accounts
2. Click "Create Service Account"
3. Name: "flower-bot"
4. Click "Create and Continue"
5. Role: "Editor"
6. Click "Done"
7. Click on the service account
8. Go to "Keys" tab
9. Add Key → Create New Key → JSON
10. Download file
11. Rename to: google-credentials.json
12. Move to: c:\bring_my_flowers\
```

### 1.4 Create Google Sheet
```
1. Go to: https://sheets.google.com
2. Create new spreadsheet
3. Name: "Bring My Flowers Data"
4. Copy Spreadsheet ID from URL:
   https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
5. Click "Share"
6. Add the service account email (from JSON file)
7. Give "Editor" permission
8. Done!
```

---

## Step 2: Razorpay (3 min)

### 2.1 Sign Up
```
1. Go to: https://razorpay.com
2. Sign up (free account)
3. Verify email
```

### 2.2 Get API Keys
```
1. Dashboard → Settings → API Keys
2. Click "Generate Test Key"
3. Copy:
   - Key ID: rzp_test_xxxxx
   - Key Secret: xxxxxxxxx
```

---

## Step 3: Configure (2 min)

### 3.1 Update .env
```bash
# Open .env file and add:

# Google
GOOGLE_CREDENTIALS_PATH=./google-credentials.json
GOOGLE_SPREADSHEET_ID=YOUR_SPREADSHEET_ID_HERE

# Razorpay
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your_secret_here

# Payment callback (will update after ngrok)
PAYMENT_CALLBACK_URL=https://your-ngrok.ngrok-free.dev/payment/success
```

### 3.2 Verify Credentials File
```bash
# Check file exists:
dir google-credentials.json

# Should show the file in project root
```

---

## Step 4: Build & Run (5 min)

### 4.1 Build
```bash
cd c:\bring_my_flowers
npm run build
```

Should see: ✅ Success (no errors)

### 4.2 Verify Setup
```bash
npm run verify:enhanced
```

Should see all ✓ checks passed

### 4.3 Start ngrok
```bash
# In a NEW terminal:
ngrok http 3000
```

Copy the HTTPS URL (e.g., https://abc123.ngrok-free.dev)

### 4.4 Update .env with ngrok URL
```bash
# Update this line:
PAYMENT_CALLBACK_URL=https://your-ngrok-url.ngrok-free.dev/payment/success
```

### 4.5 Start Bot
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

---

## Step 5: Configure Webhooks (3 min)

### 5.1 Twilio WhatsApp Webhook
```
1. Go to: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn
2. Sandbox Settings
3. "When a message comes in":
   https://your-ngrok.ngrok-free.dev/webhook/whatsapp
4. Save
```

### 5.2 Razorpay Webhook
```
1. Razorpay Dashboard → Settings → Webhooks
2. Add Webhook URL:
   https://your-ngrok.ngrok-free.dev/webhook/payment
3. Events: Select "payment_link.paid"
4. Save
```

---

## Step 6: Test! (2 min)

### Test Order Creation
Send to Twilio WhatsApp number:

```
I want to order 50 red roses for tomorrow
```

**Expected Flow:**
1. Bot processes with AI ✅
2. Checks inventory ✅
3. Calculates price ✅
4. Sends payment link ✅
5. Click link and pay ✅
6. Order confirmed automatically ✅
7. Google Sheet updated ✅
8. Calendar event created ✅

### Test Multi-Language
```
Arabic: أريد 30 وردة
Hindi: मुझे 50 गुलाब चाहिए
Urdu: مجھے 100 گلاب چاہیے
```

Bot responds in same language!

---

## 🎯 You're Done!

Your enhanced bot is now:
- ✅ Processing orders with AI
- ✅ Accepting payments
- ✅ Supporting 4 languages
- ✅ Syncing with Google Calendar
- ✅ Monitoring inventory
- ✅ Accessible from anywhere (cloud)

---

## 📊 Check Your Data

### Google Sheets
Go to your spreadsheet:
- **Inventory**: See all flowers
- **Orders**: All orders with payment status
- **FAQ**: Pre-loaded questions

### Google Calendar
Check your calendar:
- Delivery events auto-created
- Low stock alerts

---

## 🔧 Troubleshooting

### Bot not starting?
```bash
# Check logs:
type logs\app.log | Select-String -Pattern "error" -Context 2

# Verify setup:
npm run verify:enhanced
```

### Payment not working?
```bash
# Check Razorpay dashboard for webhook logs
# Verify ngrok is running
# Check .env has correct webhook URL
```

### Google Sheets error?
```bash
# Verify google-credentials.json exists
# Check sheet is shared with service account
# Verify APIs are enabled in Google Cloud
```

---

## 💡 Next Steps

1. **Add More Flowers**: Update Inventory sheet directly
2. **Customize Prices**: Edit unit_price in sheet
3. **Add FAQ**: Add common questions to FAQ sheet
4. **Test Voice**: Call Twilio number and speak order
5. **Monitor Inventory**: Wait for hourly check or low stock

---

## 📞 Need Help?

- Full Setup: `ENHANCED_SETUP.md`
- Features: `WHATS_NEW.md`
- Status: `IMPLEMENTATION_STATUS.md`
- Logs: `logs/app.log`

**Happy Automating! 🌸🚀**

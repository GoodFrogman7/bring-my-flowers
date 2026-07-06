# Testing Guide

This guide covers how to test the WhatsApp chatbot system.

## Pre-Testing Checklist

- [ ] Ollama is installed and running
- [ ] Llama3 model is pulled (`ollama pull llama3`)
- [ ] Dependencies are installed (`npm install`)
- [ ] Project is built (`npm run build`)
- [ ] Owner numbers are configured in `.env`

## Test 1: Ollama Connection

```bash
npm run test:ollama
```

**Expected Output**:
```
✓ Ollama health: OK
✓ Message classification working
✓ Daily summary generation working
✅ All tests completed!
```

**If Failed**:
- Ensure Ollama is running: `ollama serve`
- Check model is pulled: `ollama list`
- Verify endpoint in config: `http://localhost:11434`

## Test 2: Add Sample Data

```bash
npm run add:sample
```

**Expected Output**:
```
✓ Added order ORD-001 for Rajesh Kumar
✓ Added order ORD-002 for Priya Sharma
✓ Added order ORD-003 for Anita Desai
✅ Sample data added successfully!
```

**Verify**:
- Check `data/business_data.xlsx` exists
- Open Excel file and verify Orders, Inventory, Deliveries sheets

## Test 3: Start the Bot

```bash
npm start
```

**Expected Output**:
```
🌸 Starting Bring My Flowers Chatbot...
✓ Ollama is healthy
✓ Excel manager initialized
✓ WhatsApp bot started
[QR CODE APPEARS]
✓ WhatsApp bot connected successfully
✓ Daily summary scheduler started
🎉 Bring My Flowers Chatbot is fully operational!
```

**Actions**:
1. Scan QR code with WhatsApp
2. Wait for connection confirmation
3. Keep terminal open

## Test 4: Message Handling

### Test 4.1: Cancellation

**From**: +919876543210 (Rajesh Kumar - has sample order)

**Send**: "No delivery today"

**Expected Bot Response**:
```
✅ Confirmation

Action: Delivery Canceled
Your delivery for [today's date] has been canceled.
Order ID: ORD-001
Items: Roses
Amount: ₹500

Thank you for using our service! 🌸
```

**Expected Delivery Boy Notification** (to +919876543220):
```
🚫 Delivery Cancellation Alert

Order ID: ORD-001
Customer: Rajesh Kumar
Phone: +919876543210
Items: Roses (10 units)
Scheduled Date: [today]

Status: CANCELED
Reason: Customer requested cancellation

Please remove this delivery from your schedule.
```

**Verify**:
- Check Excel: Order status changed to "CANCELED"
- Check Excel: Inventory increased by 10 Roses
- Check logs: Action logged in `logs/audit.log`

### Test 4.2: Reschedule

**From**: +919876543211 (Priya Sharma)

**Send**: "Deliver tomorrow instead"

**Expected Bot Response**:
```
✅ Confirmation

Action: Delivery Rescheduled
Your delivery has been rescheduled.
Order ID: ORD-002
Items: Lilies
Original Date: [today]
New Date: [tomorrow]

We'll deliver on the new date. Thank you for your patience!

Thank you for using our service! 🌸
```

**Verify**:
- Check Excel: Order status changed to "RESCHEDULED"
- Delivery boy notified

### Test 4.3: Inquiry

**From**: Any number

**Send**: "Do you have roses available?"

**Expected Bot Response**:
Natural language response from Ollama mentioning available inventory.

**Verify**:
- Response is relevant and helpful
- No errors in logs

### Test 4.4: Unknown Message

**From**: Any number

**Send**: "Random gibberish xyz123"

**Expected Bot Response**:
```
I'm not sure I understood that. I can help you with:

• Canceling today's delivery
• Rescheduling your delivery
• Checking your order status
• Answering questions about our flowers

How can I assist you?
```

### Test 4.5: Rate Limiting

**From**: Same number

**Send**: 25 messages rapidly

**Expected**: After 20 messages in a minute:
```
You're sending messages too quickly. Please wait a moment and try again.
```

## Test 5: Daily Summary

### Manual Trigger

You can manually trigger a summary without waiting for scheduled time:

**Option A**: Modify the code temporarily to trigger immediately

**Option B**: Wait until scheduled time (22:00 by default)

**Expected Output** (sent to owner numbers):
```
📊 Daily Business Summary - [date]

Orders: 3 total (0 delivered, 1 canceled)
Revenue: ₹0.00
Costs: ₹0.00
Profit: ₹0.00 📉

Inventory Used:


Remaining Stock:
- Roses: 110 units
- Lilies: 60 units
- Tulips: 40 units

[Natural language insights from Ollama]
```

**Verify**:
- Summary sent to all owner numbers
- Daily log added to Excel
- Metrics are accurate

## Test 6: Error Handling

### Test 6.1: Ollama Down

1. Stop Ollama: Close Ollama application
2. Send message to bot
3. **Expected**: Fallback to rule-based classification
4. Check logs for error handling

### Test 6.2: Excel File Locked

1. Open `data/business_data.xlsx` in Excel
2. Send cancellation message
3. **Expected**: File lock retry mechanism works
4. Close Excel and verify operation completes

### Test 6.3: WhatsApp Disconnect

1. Turn off internet briefly
2. **Expected**: Auto-reconnect after internet returns
3. Check logs for reconnection attempts

## Test 7: Data Integrity

### Backup Verification

1. Send cancellation message
2. Check `backups/` folder
3. **Expected**: New backup file created before modification
4. Verify backup contains pre-modification data

### Excel Schema

Open `data/business_data.xlsx` and verify:

**Orders Sheet**:
- Columns: order_id, customer_id, customer_name, customer_phone, date, status, items, quantity, amount, delivery_boy, notes

**Inventory Sheet**:
- Columns: item_name, quantity, unit_price, cost_price, last_updated
- Initial items: Roses, Lilies, Tulips

**Deliveries Sheet**:
- Columns: delivery_id, order_id, customer_id, customer_name, delivery_boy, delivery_boy_phone, scheduled_date, status, notes

**Daily_Logs Sheet**:
- Columns: date, total_orders, delivered_orders, canceled_orders, total_sales, total_costs, profit, notes

## Test 8: Logs Verification

### Application Logs

```bash
# View recent logs
Get-Content logs/app.log -Tail 50
```

**Should contain**:
- Startup messages
- WhatsApp connection status
- Message received/sent logs
- Ollama API calls
- Excel operations

### Audit Trail

```bash
# View audit logs
Get-Content logs/audit.log -Tail 50
```

**Should contain**:
- All order status changes
- Inventory updates
- Delivery notifications sent
- Daily summaries generated

## Test 9: Load Testing

### Simulate Multiple Customers

Send messages from 3+ different numbers simultaneously:

**Expected**:
- All messages processed
- Responses sent to correct numbers
- No race conditions in Excel
- Rate limiting works per number

## Test 10: End-to-End Workflow

Complete business day simulation:

1. **Morning**: Add sample orders
2. **Midday**: Customer cancels (test cancellation)
3. **Afternoon**: Customer reschedules (test reschedule)
4. **Evening**: Customer inquires (test inquiry)
5. **10 PM**: Daily summary generated
6. **Verify**: All data in Excel, all notifications sent, summary accurate

## Troubleshooting Tests

### If Bot Doesn't Respond

1. Check bot is running: Terminal shows "fully operational"
2. Check WhatsApp connected: Look for connection message
3. Check logs: `logs/app.log` for errors
4. Verify phone number format: Must match Excel data

### If Ollama Errors

1. Check Ollama running: `ollama list`
2. Check model available: Should show llama3
3. Check endpoint: `http://localhost:11434`
4. Test manually: `ollama run llama3 "Hello"`

### If Excel Errors

1. Close Excel if open
2. Check file permissions
3. Check backups folder for recent backup
4. Verify file path in config

## Performance Benchmarks

**Expected Performance**:
- Message classification: < 5 seconds
- Excel operations: < 1 second
- WhatsApp send: < 2 seconds
- Daily summary: < 10 seconds

**Monitor**:
- Check logs for timing information
- Watch for timeout errors
- Verify no memory leaks over time

## Security Testing

1. **Session Security**: Verify `sessions/` folder is not shared
2. **Data Privacy**: Check `.gitignore` includes sensitive files
3. **Phone Validation**: Try invalid phone numbers
4. **SQL Injection**: N/A (using Excel, not SQL)
5. **Rate Limiting**: Verified in Test 4.5

## Cleanup After Testing

```bash
# Remove test data
npm run clean

# Or manually:
# Delete data/*.xlsx
# Delete sessions/
# Delete backups/
# Delete logs/
```

## Success Criteria

✅ All tests pass
✅ No errors in logs
✅ Data correctly updated in Excel
✅ Notifications sent successfully
✅ Daily summary generated
✅ Auto-reconnect works
✅ Error handling graceful
✅ Performance acceptable

## Next Steps After Testing

1. Add real customer data to Excel
2. Configure actual owner phone numbers
3. Add real delivery boy phone numbers
4. Run in production mode (PM2 or Windows Service)
5. Monitor logs daily
6. Regular backup of Excel file

---

**Testing Complete!** Your chatbot is ready for production use. 🎉


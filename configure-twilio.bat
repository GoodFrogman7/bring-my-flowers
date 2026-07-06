@echo off
echo Creating .env file with Twilio credentials...

(
echo # Twilio Credentials
echo TWILIO_ACCOUNT_SID=your_account_sid_here
echo TWILIO_AUTH_TOKEN=your_auth_token_here
echo TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
echo.
echo # Webhook Port
echo WEBHOOK_PORT=3000
echo.
echo # Owner WhatsApp Numbers
echo OWNER_NUMBERS=
echo.
echo # Ollama Configuration
echo OLLAMA_ENDPOINT=http://localhost:11434
echo OLLAMA_MODEL=llama3
echo.
echo # Data File Path
echo EXCEL_FILE_PATH=./data/business_data.xlsx
echo.
echo # Daily Summary Time
echo SUMMARY_TIME=22:00
echo.
echo # Bot Configuration
echo SESSION_PATH=./sessions
echo BACKUP_PATH=./backups
echo.
echo # Logging
echo LOG_LEVEL=info
) > .env

echo .env file created successfully!
echo.
echo Next steps:
echo 1. Download ngrok from https://ngrok.com/download
echo 2. Run in NEW terminal: ngrok http 3000
echo 3. Copy the ngrok HTTPS URL
echo 4. Set webhook in Twilio console
echo 5. Run: npm run start:twilio
echo.
pause


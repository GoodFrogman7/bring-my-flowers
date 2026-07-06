# Troubleshooting Guide

Common issues and their solutions.

## Installation Issues

### "npm install" fails

**Problem**: Dependencies won't install

**Solutions**:
1. Check Node.js version: `node --version` (need 18+)
2. Clear npm cache: `npm cache clean --force`
3. Delete `node_modules` and try again
4. Check internet connection

### "tsc not found" error

**Problem**: TypeScript not installed

**Solution**:
```bash
npm install
```

TypeScript is in devDependencies and will be installed.

## Ollama Issues

### "Ollama is not responding"

**Problem**: Can't connect to Ollama

**Solutions**:
1. Check if Ollama is installed:
   ```bash
   ollama --version
   ```
   If not: Download from https://ollama.ai/

2. Check if Ollama is running:
   ```bash
   ollama list
   ```

3. Start Ollama if needed:
   ```bash
   ollama serve
   ```

4. Verify model is pulled:
   ```bash
   ollama pull llama3
   ```

5. Check endpoint in `config/settings.json`:
   ```json
   {
     "ollama": {
       "endpoint": "http://localhost:11434"
     }
   }
   ```

### "Model not found"

**Problem**: Llama3 model not available

**Solution**:
```bash
ollama pull llama3
```

Wait for download to complete (about 4GB).

### Ollama responses are slow

**Problem**: LLM taking too long

**Solutions**:
1. Use smaller model: `ollama pull llama3:8b`
2. Increase timeout in config
3. Check system resources (RAM, CPU)
4. Close other applications

## WhatsApp Connection Issues

### QR Code won't appear

**Problem**: No QR code in terminal

**Solutions**:
1. Check bot is running: Look for startup messages
2. Check logs: `logs/app.log`
3. Delete `sessions/` folder and restart
4. Ensure terminal supports QR code display

### QR Code won't scan

**Problem**: WhatsApp won't accept QR code

**Solutions**:
1. Make sure QR code is fully visible
2. Try scanning from different angle
3. Ensure phone has internet connection
4. Delete `sessions/` folder and restart bot
5. Make sure WhatsApp is updated on phone

### "Connection closed" repeatedly

**Problem**: Bot keeps disconnecting

**Solutions**:
1. Check internet connection
2. Ensure WhatsApp Web is not logged in elsewhere
3. Delete `sessions/` folder and re-authenticate
4. Check if WhatsApp account is banned/restricted
5. Wait a few hours if rate limited

### Bot doesn't respond to messages

**Problem**: Messages sent but no response

**Solutions**:
1. Check bot is connected: Look for "fully operational" message
2. Verify sender's phone number matches Excel data
3. Check logs: `logs/app.log` for errors
4. Ensure Ollama is running
5. Test with sample data: `npm run add:sample`

## Excel/Data Issues

### "Cannot open Excel file"

**Problem**: Excel file locked or inaccessible

**Solutions**:
1. Close Excel if file is open
2. Check file permissions in `data/` folder
3. Ensure `data/` folder exists
4. Check disk space
5. Restore from `backups/` if corrupted

### "File is locked"

**Problem**: Another process has the file

**Solutions**:
1. Close Excel
2. Close any other programs using the file
3. Wait a moment and try again (file locking has retry)
4. Restart bot if persistent

### Data not updating

**Problem**: Changes not reflected in Excel

**Solutions**:
1. Close and reopen Excel file
2. Check logs for write errors
3. Verify backups are being created
4. Check file permissions
5. Ensure no Excel errors in logs

### Backup folder full

**Problem**: Too many backup files

**Solution**: Old backups are auto-deleted (keeps last 10). If needed:
```bash
# Manually clean old backups
cd backups
# Delete old files manually
```

## Message Handling Issues

### Bot misclassifies messages

**Problem**: Wrong intent detected

**Solutions**:
1. Check Ollama is running properly
2. Try more explicit messages:
   - Instead of "no": "No delivery today"
   - Instead of "tomorrow": "Deliver tomorrow instead"
3. Check confidence score in logs
4. Fallback rules should still work

### Rate limit triggered incorrectly

**Problem**: "Too many messages" error

**Solutions**:
1. Wait 1 minute and try again
2. Adjust rate limit in config:
   ```json
   {
     "messaging": {
       "rateLimitPerMinute": 30
     }
   }
   ```
3. Restart bot after config change

### Notifications not sent

**Problem**: Delivery boys not receiving alerts

**Solutions**:
1. Verify delivery boy phone numbers in Excel
2. Check bot is connected to WhatsApp
3. Check logs for send errors
4. Verify phone number format: +[country][number]
5. Test by sending to your own number

## Daily Summary Issues

### Summary not sent at scheduled time

**Problem**: No summary at 10 PM

**Solutions**:
1. Check bot is running at scheduled time
2. Verify time in config: `config/settings.json`
3. Check timezone settings
4. Look for errors in logs at scheduled time
5. Manually trigger for testing (modify code temporarily)

### Summary has wrong data

**Problem**: Metrics are incorrect

**Solutions**:
1. Verify data in Excel is correct
2. Check order statuses are set properly
3. Ensure inventory updates are working
4. Review Daily_Logs sheet for history
5. Check calculation logic in logs

### Summary not received by owners

**Problem**: Owners didn't get WhatsApp message

**Solutions**:
1. Verify owner numbers in `.env`:
   ```env
   OWNER_NUMBERS=+919876543210,+919876543211
   ```
2. Check numbers have country code
3. Ensure bot is connected at summary time
4. Check logs for send errors
5. Test by sending manual message

## Build/Compilation Issues

### TypeScript errors

**Problem**: `npm run build` fails

**Solutions**:
1. Check TypeScript version: `npm list typescript`
2. Delete `dist/` and rebuild
3. Run `npm install` again
4. Check for syntax errors in code
5. Review error messages carefully

### Import errors

**Problem**: "Cannot find module" errors

**Solutions**:
1. Run `npm install`
2. Check `node_modules/` exists
3. Verify imports match file names
4. Check tsconfig.json paths

## Runtime Errors

### "Out of memory"

**Problem**: Node.js runs out of memory

**Solutions**:
1. Restart bot
2. Increase Node.js memory:
   ```bash
   node --max-old-space-size=4096 dist/index.js
   ```
3. Check for memory leaks in logs
4. Close other applications

### "Port already in use"

**Problem**: Ollama port conflict

**Solutions**:
1. Check what's using port 11434
2. Stop other Ollama instances
3. Change port in config if needed

### Unhandled promise rejection

**Problem**: Async error not caught

**Solutions**:
1. Check logs for full error
2. Report issue with error details
3. Restart bot
4. Check for network issues

## Log Issues

### Logs folder empty

**Problem**: No log files created

**Solutions**:
1. Check `logs/` folder exists
2. Verify write permissions
3. Check logger configuration
4. Restart bot

### Logs too large

**Problem**: Log files growing too big

**Solutions**:
1. Rotate logs manually:
   ```bash
   cd logs
   # Archive old logs
   # Delete or compress
   ```
2. Adjust log level in `.env`:
   ```env
   LOG_LEVEL=warn
   ```
3. Implement log rotation (future enhancement)

## Performance Issues

### Bot is slow

**Problem**: Responses take too long

**Solutions**:
1. Check Ollama performance
2. Reduce Ollama timeout in config
3. Check system resources (CPU, RAM)
4. Close other applications
5. Consider faster model

### High CPU usage

**Problem**: Bot using too much CPU

**Solutions**:
1. Check for infinite loops in logs
2. Reduce message processing frequency
3. Use lighter Ollama model
4. Check for memory leaks

## Security Issues

### Session folder exposed

**Problem**: WhatsApp credentials at risk

**Solutions**:
1. Ensure `.gitignore` includes `sessions/`
2. Don't share `sessions/` folder
3. Set proper file permissions
4. Re-authenticate if compromised

### Data privacy concerns

**Problem**: Customer data security

**Solutions**:
1. Keep Excel file secure
2. Regular backups
3. Don't share `.env` file
4. Use proper file permissions
5. Consider encryption for sensitive data

## Getting Help

### Check Logs First

```bash
# View recent application logs
Get-Content logs/app.log -Tail 100

# View audit trail
Get-Content logs/audit.log -Tail 50

# Search for errors
Select-String -Path logs/app.log -Pattern "error"
```

### Collect Debug Information

When reporting issues, include:
1. Error message from logs
2. Node.js version: `node --version`
3. Ollama version: `ollama --version`
4. Operating system
5. Steps to reproduce
6. Recent changes made

### Emergency Recovery

If bot is completely broken:

```bash
# 1. Stop the bot (Ctrl+C)

# 2. Backup current data
cp data/business_data.xlsx data/business_data.backup.xlsx

# 3. Clean everything
npm run clean

# 4. Reinstall
npm install

# 5. Rebuild
npm run build

# 6. Restore data
cp data/business_data.backup.xlsx data/business_data.xlsx

# 7. Re-authenticate WhatsApp
npm start
# Scan QR code again
```

## Prevention Tips

1. **Regular Backups**: Excel auto-backs up, but also manual backup weekly
2. **Monitor Logs**: Check logs daily for errors
3. **Keep Updated**: Update dependencies periodically
4. **Test Changes**: Test in dev before production
5. **Document Issues**: Keep notes of problems and solutions

## Still Having Issues?

1. Review all documentation:
   - README.md
   - SETUP.md
   - TESTING.md
   - This file

2. Check logs thoroughly

3. Try clean reinstall

4. Verify all prerequisites are met

5. Test with sample data

---

**Most issues are resolved by**:
- Restarting the bot
- Checking Ollama is running
- Verifying configuration
- Reading the logs

Good luck! 🌸


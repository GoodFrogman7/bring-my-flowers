/**
 * Enhanced Setup Verification Script
 * Checks all requirements for the enhanced version
 */

import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  reset: '\x1b[0m'
};

const check = (condition: boolean, message: string) => {
  const icon = condition ? '✓' : '✗';
  const color = condition ? colors.green : colors.red;
  console.log(`${color}${icon}${colors.reset} ${message}`);
  return condition;
};

async function verifyEnhancedSetup() {
  console.log('\n🔍 Verifying Enhanced Setup...\n');

  let allGood = true;

  // 1. Check .env file
  const envPath = path.join(process.cwd(), '.env');
  const hasEnv = check(fs.existsSync(envPath), '.env file exists');
  allGood = allGood && hasEnv;

  if (hasEnv) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    
    // Check Twilio
    check(envContent.includes('TWILIO_ACCOUNT_SID'), '  - TWILIO_ACCOUNT_SID set');
    check(envContent.includes('TWILIO_AUTH_TOKEN'), '  - TWILIO_AUTH_TOKEN set');
    check(envContent.includes('TWILIO_WHATSAPP_NUMBER'), '  - TWILIO_WHATSAPP_NUMBER set');

    // Check Google
    const hasGoogleSpreadsheet = envContent.includes('GOOGLE_SPREADSHEET_ID=') && 
                                  !envContent.includes('GOOGLE_SPREADSHEET_ID=\n') &&
                                  !envContent.includes('GOOGLE_SPREADSHEET_ID=\r');
    check(hasGoogleSpreadsheet, '  - GOOGLE_SPREADSHEET_ID set');
    allGood = allGood && hasGoogleSpreadsheet;

    // Check Razorpay
    const hasRazorpayKey = envContent.includes('RAZORPAY_KEY_ID=') && 
                           !envContent.includes('RAZORPAY_KEY_ID=\n');
    const hasRazorpaySecret = envContent.includes('RAZORPAY_KEY_SECRET=') && 
                              !envContent.includes('RAZORPAY_KEY_SECRET=\n');
    check(hasRazorpayKey, '  - RAZORPAY_KEY_ID set');
    check(hasRazorpaySecret, '  - RAZORPAY_KEY_SECRET set');
    allGood = allGood && hasRazorpayKey && hasRazorpaySecret;
  }

  // 2. Check Google credentials file
  const googleCredsPath = path.join(process.cwd(), 'google-credentials.json');
  const hasGoogleCreds = check(fs.existsSync(googleCredsPath), 'google-credentials.json exists');
  allGood = allGood && hasGoogleCreds;

  if (hasGoogleCreds) {
    try {
      const creds = JSON.parse(fs.readFileSync(googleCredsPath, 'utf-8'));
      check(creds.type === 'service_account', '  - Valid service account JSON');
      check(creds.project_id !== undefined, '  - Project ID present');
      check(creds.client_email !== undefined, '  - Service account email present');
    } catch (error) {
      check(false, '  - Invalid JSON format');
      allGood = false;
    }
  }

  // 3. Check Ollama
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    const ollamaRunning = response.ok;
    check(ollamaRunning, 'Ollama is running');
    allGood = allGood && ollamaRunning;

    if (ollamaRunning) {
      const data: any = await response.json();
      const hasLlama = data.models?.some((m: any) => m.name.includes('llama'));
      check(hasLlama, '  - llama3 model available');
    }
  } catch (error) {
    check(false, 'Ollama is running');
    allGood = false;
  }

  // 4. Check build
  const distPath = path.join(process.cwd(), 'dist', 'index-enhanced.js');
  const isBuilt = check(fs.existsSync(distPath), 'Project is built (dist/index-enhanced.js exists)');
  if (!isBuilt) {
    console.log(`  ${colors.yellow}→ Run: npm run build${colors.reset}`);
  }
  allGood = allGood && isBuilt;

  // 5. Check node_modules
  const nmPath = path.join(process.cwd(), 'node_modules');
  const hasNM = check(fs.existsSync(nmPath), 'Dependencies installed');
  if (!hasNM) {
    console.log(`  ${colors.yellow}→ Run: npm install${colors.reset}`);
  }
  allGood = allGood && hasNM;

  // Summary
  console.log('\n' + '='.repeat(50));
  if (allGood) {
    console.log(`${colors.green}✓ ALL CHECKS PASSED!${colors.reset}`);
    console.log('\nYou can start the enhanced bot with:');
    console.log(`  ${colors.blue}npm run start:enhanced${colors.reset}\n`);
    console.log('Then expose webhook with ngrok:');
    console.log(`  ${colors.blue}ngrok http 3000${colors.reset}\n`);
  } else {
    console.log(`${colors.red}✗ SETUP INCOMPLETE${colors.reset}`);
    console.log('\nMissing items need to be configured.');
    console.log(`See ${colors.yellow}ENHANCED_SETUP.md${colors.reset} for instructions.\n`);
  }
  console.log('='.repeat(50) + '\n');
}

verifyEnhancedSetup().catch(console.error);

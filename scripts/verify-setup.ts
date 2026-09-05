/**
 * Verification script to check if everything is set up correctly
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: CheckResult[] = [];

function check(name: string, condition: boolean, passMsg: string, failMsg: string) {
  results.push({
    name,
    passed: condition,
    message: condition ? passMsg : failMsg
  });
}

async function verifySetup() {
  const requestedMode = (process.argv[2] || process.env.BOT_MODE || 'baileys')
    .replace(/^--mode=/, '')
    .toLowerCase();
  const businessMode = requestedMode === 'business';
  const businessTransport = (process.env.BUSINESS_TRANSPORT || 'dashboard').trim().toLowerCase();
  const dashboardMode = businessMode && (businessTransport === 'dashboard' || businessTransport === 'manual');
  const needsUpdatesGroup = businessMode && !dashboardMode && !['cloud', 'twilio'].includes(businessTransport);
  const useOllama = !businessMode || ['1', 'true', 'yes'].includes((process.env.BUSINESS_USE_OLLAMA || '').trim().toLowerCase());
  console.log('🔍 Verifying Bring My Flowers Bot Setup...\n');

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  check(
    'Node.js Version',
    majorVersion >= 18,
    `✓ Node.js ${nodeVersion} (OK)`,
    `✗ Node.js ${nodeVersion} (Need 18+)`
  );

  // Check required directories
  const dirs = ['config', 'src', 'dist', 'scripts'];
  for (const dir of dirs) {
    check(
      `Directory: ${dir}`,
      fs.existsSync(dir),
      `✓ ${dir}/ exists`,
      `✗ ${dir}/ missing`
    );
  }

  // Check required files
  const files = [
    'package.json',
    'tsconfig.json',
    'config/settings.json',
    'src/index.ts',
    'src/bot/whatsapp.ts',
    'src/llm/ollama.ts',
    'src/data/excelManager.ts',
    'README.md'
  ];

  for (const file of files) {
    check(
      `File: ${file}`,
      fs.existsSync(file),
      `✓ ${file} exists`,
      `✗ ${file} missing`
    );
  }

  // Check if built
  check(
    'TypeScript Build',
    fs.existsSync('dist/index.js'),
    '✓ Project is built',
    '✗ Project not built (run: npm run build)'
  );

  // Check node_modules
  check(
    'Dependencies',
    fs.existsSync('node_modules'),
    '✓ Dependencies installed',
    '✗ Dependencies not installed (run: npm install)'
  );

  // Check .env file
  const envExists = fs.existsSync('.env');
  check(
    'Environment File',
    envExists,
    '✓ .env file exists',
    '⚠ .env file missing (copy from .env.example)'
  );

  if (envExists) {
    const envContent = fs.readFileSync('.env', 'utf-8');
    const ownerNumbersConfigured = envContent
      .split(/\r?\n/)
      .some(line => /^\s*OWNER_NUMBERS\s*=\s*[^#\s].*$/i.test(line));
    check(
      'Owner Numbers',
      businessMode || ownerNumbersConfigured,
      businessMode ? '✓ Owner numbers optional in business mode' : '✓ Owner numbers configured',
      '⚠ Owner numbers not set in .env'
    );
    if (businessMode) {
      const groupConfigured = /^\s*UPDATES_GROUP_JID\s*=\s*[^\s#].*$/mi.test(envContent);
      check(
        'Updates intake',
        !needsUpdatesGroup || groupConfigured,
        dashboardMode
          ? 'Dashboard intake selected; WhatsApp group optional'
          : needsUpdatesGroup
            ? 'Updates group configured'
            : `${businessTransport} transport selected; WhatsApp group optional`,
        'UPDATES_GROUP_JID is not set in .env for the selected business transport'
      );
    }
  }

  // Check config
  if (fs.existsSync('config/settings.json')) {
    try {
      const config = JSON.parse(fs.readFileSync('config/settings.json', 'utf-8'));
      check(
        'Ollama Endpoint',
        !useOllama || config.ollama?.endpoint === 'http://localhost:11434',
        useOllama ? '✓ Ollama endpoint configured' : '✓ Ollama not required for business mode',
        '⚠ Ollama endpoint not standard'
      );
      check(
        'Ollama Model',
        !useOllama || config.ollama?.model === (process.env.OLLAMA_MODEL || config.ollama?.model),
        useOllama ? `✓ Ollama model set to ${config.ollama?.model}` : '✓ Ollama not required for business mode',
        `⚠ Config model ${config.ollama?.model} differs from OLLAMA_MODEL=${process.env.OLLAMA_MODEL}`
      );
    } catch (e) {
      check(
        'Config File',
        false,
        '',
        '✗ config/settings.json is invalid JSON'
      );
    }
  }

  // Check Ollama only when the selected mode uses it.
  if (useOllama) {
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(3000)
    });
    check(
      'Ollama Connection',
      response.ok,
      '✓ Ollama is running and accessible',
      '✗ Ollama is not responding'
    );
  } catch (e) {
    check(
      'Ollama Connection',
      false,
      '',
      '✗ Cannot connect to Ollama (is it running?)'
    );
  }
  } else {
    check('Ollama Connection', true, 'Ollama not required for business mode', '');
  }

  // Print results
  console.log('═══════════════════════════════════════════════════\n');
  
  let allPassed = true;
  for (const result of results) {
    console.log(result.message);
    if (!result.passed) allPassed = false;
  }

  console.log('\n═══════════════════════════════════════════════════\n');

  if (allPassed) {
    console.log('✅ All checks passed! You\'re ready to start the bot.\n');
    console.log('Next steps:');
    if (dashboardMode) {
      console.log('1. Start the bot: Launch-BMF.bat');
      console.log('2. Open the owner dashboard');
      console.log('3. Paste staff updates, apply them, and download tomorrow\'s sheet\n');
    } else if (!useOllama) {
      console.log('1. Start the bot: Launch-BMF.bat');
      console.log('2. Open the Link page and scan the QR code with WhatsApp');
      console.log('3. Use the Updates group and dashboard for daily operations\n');
    } else {
      const configuredModel = process.env.OLLAMA_MODEL || 'llama3.2:3b';
      console.log(`1. Make sure Ollama has the configured model: ollama pull ${configuredModel}`);
      console.log('2. Configure owner numbers in .env file');
      console.log('3. Start the bot: npm start');
      console.log('4. Scan QR code with WhatsApp\n');
    }
  } else {
    console.log('⚠️  Some checks failed. Please fix the issues above.\n');
    console.log('Common fixes:');
    console.log('- Run: npm install');
    console.log('- Run: npm run build');
    console.log(dashboardMode
      ? '- Copy config/business.env.template to .env and keep BUSINESS_TRANSPORT=dashboard'
      : businessMode
        ? '- Copy config/business.env.template to .env and set UPDATES_GROUP_JID'
        : '- Copy .env.example to .env and configure');
    if (useOllama) {
      console.log('- Install Ollama: https://ollama.ai/');
      console.log('- Start Ollama: ollama serve');
    }
    console.log('');
  }

  console.log('For detailed setup instructions, see SETUP.md');
  console.log('For troubleshooting, see TROUBLESHOOTING.md\n');
}

verifySetup().catch(console.error);


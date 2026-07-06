/**
 * Verification script to check if everything is set up correctly
 */
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
    check(
      'Owner Numbers',
      envContent.includes('OWNER_NUMBERS=') && !envContent.includes('OWNER_NUMBERS=\n'),
      '✓ Owner numbers configured',
      '⚠ Owner numbers not set in .env'
    );
  }

  // Check config
  if (fs.existsSync('config/settings.json')) {
    try {
      const config = JSON.parse(fs.readFileSync('config/settings.json', 'utf-8'));
      check(
        'Ollama Endpoint',
        config.ollama?.endpoint === 'http://localhost:11434',
        '✓ Ollama endpoint configured',
        '⚠ Ollama endpoint not standard'
      );
      check(
        'Ollama Model',
        config.ollama?.model === 'llama3',
        '✓ Ollama model set to llama3',
        '⚠ Ollama model not llama3'
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

  // Check Ollama (try to connect)
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
    console.log('1. Make sure Ollama has llama3 model: ollama pull llama3');
    console.log('2. Configure owner numbers in .env file');
    console.log('3. Start the bot: npm start');
    console.log('4. Scan QR code with WhatsApp\n');
  } else {
    console.log('⚠️  Some checks failed. Please fix the issues above.\n');
    console.log('Common fixes:');
    console.log('- Run: npm install');
    console.log('- Run: npm run build');
    console.log('- Copy .env.example to .env and configure');
    console.log('- Install Ollama: https://ollama.ai/');
    console.log('- Start Ollama: ollama serve\n');
  }

  console.log('For detailed setup instructions, see SETUP.md');
  console.log('For troubleshooting, see TROUBLESHOOTING.md\n');
}

verifySetup().catch(console.error);


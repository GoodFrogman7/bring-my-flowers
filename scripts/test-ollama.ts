/**
 * Test script to verify Ollama is working correctly
 */
import { OllamaClient } from '../src/llm/ollama';

async function testOllama() {
  console.log('🧪 Testing Ollama connection...\n');

  const endpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3';

  const client = new OllamaClient(endpoint, model);

  // Test 1: Health check
  console.log('Test 1: Health Check');
  const healthy = await client.checkHealth();
  console.log(`✓ Ollama health: ${healthy ? 'OK' : 'FAILED'}\n`);

  if (!healthy) {
    console.error('❌ Ollama is not responding. Please check:');
    console.error('1. Ollama is installed: https://ollama.ai/');
    console.error('2. Ollama is running: ollama serve');
    console.error(`3. Model is pulled: ollama pull ${model}`);
    process.exit(1);
  }

  // Test 2: Message classification
  console.log('Test 2: Message Classification');
  const testMessages = [
    'No delivery today please',
    'Can you deliver tomorrow instead?',
    'What is my order status?',
    'I want to order roses'
  ];

  for (const msg of testMessages) {
    try {
      const parsed = await client.classifyMessage(msg, '+919876543210');
      console.log(`Message: "${msg}"`);
      console.log(`Intent: ${parsed.intent} (confidence: ${parsed.confidence})`);
      console.log('');
    } catch (error) {
      console.error(`Failed to classify: ${msg}`, error);
    }
  }

  // Test 3: Daily summary
  console.log('Test 3: Daily Summary Generation');
  try {
    const summary = await client.generateDailySummary({
      date: new Date().toISOString().split('T')[0],
      totalOrders: 10,
      deliveredOrders: 8,
      canceledOrders: 2,
      totalRevenue: 5000,
      totalCosts: 3000,
      profit: 2000,
      inventoryUsed: [
        { item: 'Roses', quantity: 20 },
        { item: 'Lilies', quantity: 15 }
      ],
      inventoryRemaining: [
        { item: 'Roses', quantity: 80 },
        { item: 'Lilies', quantity: 45 }
      ]
    });
    console.log('Generated Summary:');
    console.log('---');
    console.log(summary);
    console.log('---\n');
  } catch (error) {
    console.error('Failed to generate summary:', error);
  }

  console.log('✅ All tests completed!');
}

testOllama().catch(console.error);


/**
 * Add sample data to Excel for testing
 */
import { ExcelManager } from '../src/data/excelManager';
import { loadConfig, ensureDirectories } from '../src/utils/config';
import { Order, Delivery } from '../src/types';

async function addSampleData() {
  console.log('📝 Adding sample data to Excel...\n');

  const config = loadConfig();
  ensureDirectories(config);

  const excelManager = new ExcelManager(
    config.excel.filePath,
    config.excel.backupPath,
    false // Don't backup for sample data
  );

  const today = new Date().toISOString().split('T')[0];

  // Sample orders
  const sampleOrders: Order[] = [
    {
      order_id: 'ORD-001',
      customer_id: 'CUST-001',
      customer_name: 'Rajesh Kumar',
      customer_phone: '+919876543210',
      date: today,
      status: 'CONFIRMED',
      items: 'Roses',
      quantity: 10,
      amount: 500,
      delivery_boy: 'Amit',
      notes: 'Morning delivery preferred'
    },
    {
      order_id: 'ORD-002',
      customer_id: 'CUST-002',
      customer_name: 'Priya Sharma',
      customer_phone: '+919876543211',
      date: today,
      status: 'CONFIRMED',
      items: 'Lilies',
      quantity: 5,
      amount: 300,
      delivery_boy: 'Amit',
      notes: ''
    },
    {
      order_id: 'ORD-003',
      customer_id: 'CUST-003',
      customer_name: 'Anita Desai',
      customer_phone: '+919876543212',
      date: today,
      status: 'PENDING',
      items: 'Tulips',
      quantity: 8,
      amount: 360,
      delivery_boy: 'Rahul',
      notes: 'Evening delivery'
    }
  ];

  console.log('Adding sample orders...');
  for (const order of sampleOrders) {
    await excelManager.addOrder(order);
    console.log(`✓ Added order ${order.order_id} for ${order.customer_name}`);
  }

  // Sample deliveries
  const sampleDeliveries: Delivery[] = [
    {
      delivery_id: 'DEL-001',
      order_id: 'ORD-001',
      customer_id: 'CUST-001',
      customer_name: 'Rajesh Kumar',
      delivery_boy: 'Amit',
      delivery_boy_phone: '+919876543220',
      scheduled_date: today,
      status: 'SCHEDULED',
      notes: ''
    },
    {
      delivery_id: 'DEL-002',
      order_id: 'ORD-002',
      customer_id: 'CUST-002',
      customer_name: 'Priya Sharma',
      delivery_boy: 'Amit',
      delivery_boy_phone: '+919876543220',
      scheduled_date: today,
      status: 'SCHEDULED',
      notes: ''
    },
    {
      delivery_id: 'DEL-003',
      order_id: 'ORD-003',
      customer_id: 'CUST-003',
      customer_name: 'Anita Desai',
      delivery_boy: 'Rahul',
      delivery_boy_phone: '+919876543221',
      scheduled_date: today,
      status: 'SCHEDULED',
      notes: ''
    }
  ];

  console.log('\nAdding sample deliveries...');
  for (const delivery of sampleDeliveries) {
    await excelManager.addDelivery(delivery);
    console.log(`✓ Added delivery ${delivery.delivery_id} for ${delivery.customer_name}`);
  }

  console.log('\n✅ Sample data added successfully!');
  console.log(`\nYou can now test the chatbot by sending messages from:`);
  console.log('- +919876543210 (Rajesh Kumar - has order)');
  console.log('- +919876543211 (Priya Sharma - has order)');
  console.log('- +919876543212 (Anita Desai - has order)');
  console.log('\nTry messages like:');
  console.log('- "No delivery today"');
  console.log('- "Deliver tomorrow instead"');
  console.log('- "What is my order status?"');
}

addSampleData().catch(console.error);


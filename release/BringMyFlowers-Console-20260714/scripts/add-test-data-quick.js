// Quick script to add test data using compiled code
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

console.log('📝 Adding test data to Excel...\n');

const filePath = './data/business_data.xlsx';
const workbook = XLSX.readFile(filePath);

const today = new Date().toISOString().split('T')[0];

// Add sample orders
const orders = [
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
  },
  {
    order_id: 'ORD-004',
    customer_id: 'CUST-004',
    customer_name: 'Vikram Singh',
    customer_phone: '+919876543213',
    date: today,
    status: 'CONFIRMED',
    items: 'Roses',
    quantity: 15,
    amount: 750,
    delivery_boy: 'Rahul',
    notes: ''
  }
];

// Add orders to sheet
const ordersSheet = workbook.Sheets['Orders'];
const currentOrders = XLSX.utils.sheet_to_json(ordersSheet);
const allOrders = [...currentOrders, ...orders];
workbook.Sheets['Orders'] = XLSX.utils.json_to_sheet(allOrders);
console.log('✓ Added 4 sample orders');

// Add deliveries
const deliveries = [
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

const deliveriesSheet = workbook.Sheets['Deliveries'];
const currentDeliveries = XLSX.utils.sheet_to_json(deliveriesSheet);
const allDeliveries = [...currentDeliveries, ...deliveries];
workbook.Sheets['Deliveries'] = XLSX.utils.json_to_sheet(allDeliveries);
console.log('✓ Added 3 sample deliveries');

// Write the file
XLSX.writeFile(workbook, filePath);

console.log('\n✅ Test data added successfully!');
console.log('\nCustomers with orders:');
console.log('- Rajesh Kumar (+919876543210) - 10 Roses');
console.log('- Priya Sharma (+919876543211) - 5 Lilies');
console.log('- Anita Desai (+919876543212) - 8 Tulips');
console.log('- Vikram Singh (+919876543213) - 15 Roses');
console.log('\nYou can now test messages from these numbers!');


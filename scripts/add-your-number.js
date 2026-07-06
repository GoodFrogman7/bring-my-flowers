// Add user's phone number to Excel
const XLSX = require('xlsx');

console.log('📝 Adding your phone number to Excel...\n');

const filePath = './data/business_data.xlsx';
const workbook = XLSX.readFile(filePath);
const today = new Date().toISOString().split('T')[0];

// Add YOUR order
const yourOrder = {
  order_id: 'ORD-005',
  customer_id: 'CUST-005',
  customer_name: 'You (Test User)',
  customer_phone: '+96567091345',
  date: today,
  status: 'CONFIRMED',
  items: 'Roses',
  quantity: 12,
  amount: 600,
  delivery_boy: 'Amit',
  notes: 'Test order for demo'
};

// Add your delivery
const yourDelivery = {
  delivery_id: 'DEL-005',
  order_id: 'ORD-005',
  customer_id: 'CUST-005',
  customer_name: 'You (Test User)',
  delivery_boy: 'Amit',
  delivery_boy_phone: '+919876543220',
  scheduled_date: today,
  status: 'SCHEDULED',
  notes: 'Demo delivery'
};

// Add to Orders sheet
const ordersSheet = workbook.Sheets['Orders'];
const orders = XLSX.utils.sheet_to_json(ordersSheet);
orders.push(yourOrder);
workbook.Sheets['Orders'] = XLSX.utils.json_to_sheet(orders);

// Add to Deliveries sheet
const deliveriesSheet = workbook.Sheets['Deliveries'];
const deliveries = XLSX.utils.sheet_to_json(deliveriesSheet);
deliveries.push(yourDelivery);
workbook.Sheets['Deliveries'] = XLSX.utils.json_to_sheet(deliveries);

// Write the file
XLSX.writeFile(workbook, filePath);

console.log('✅ Your number added to Excel!');
console.log('\nYour Order:');
console.log('- Customer: You (Test User)');
console.log('- Phone: +96567091345');
console.log('- Order: 12 Roses (₹600)');
console.log('- Status: CONFIRMED');
console.log('- Delivery Boy: Amit');
console.log('\n🎉 Ready to test! Send "No delivery today" from WhatsApp!');


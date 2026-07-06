// Add user's phone number to Excel with a test order
const XLSX = require('xlsx');

console.log('📝 Adding your number to Excel...\n');

const filePath = './data/business_data.xlsx';
const workbook = XLSX.readFile(filePath);

const today = new Date().toISOString().split('T')[0];

// Add YOUR order
const myOrder = {
  order_id: 'ORD-999',
  customer_id: 'CUST-999',
  customer_name: 'You (Test User)',
  customer_phone: '+96567091345',
  date: today,
  status: 'CONFIRMED',
  items: 'Roses',
  quantity: 20,
  amount: 1000,
  delivery_boy: 'Ahmed',
  notes: 'Test order for demo'
};

// Add to Orders sheet
const ordersSheet = workbook.Sheets['Orders'];
const currentOrders = XLSX.utils.sheet_to_json(ordersSheet);
currentOrders.push(myOrder);
workbook.Sheets['Orders'] = XLSX.utils.json_to_sheet(currentOrders);
console.log('✓ Added your order: 20 Roses, ₹1000');

// Add YOUR delivery
const myDelivery = {
  delivery_id: 'DEL-999',
  order_id: 'ORD-999',
  customer_id: 'CUST-999',
  customer_name: 'You (Test User)',
  delivery_boy: 'Ahmed',
  delivery_boy_phone: '+96512345678',
  scheduled_date: today,
  status: 'SCHEDULED',
  notes: 'Test delivery'
};

const deliveriesSheet = workbook.Sheets['Deliveries'];
const currentDeliveries = XLSX.utils.sheet_to_json(deliveriesSheet);
currentDeliveries.push(myDelivery);
workbook.Sheets['Deliveries'] = XLSX.utils.json_to_sheet(currentDeliveries);
console.log('✓ Added your delivery assignment');

// Write the file
XLSX.writeFile(workbook, filePath);

console.log('\n✅ YOUR NUMBER IS NOW IN THE SYSTEM!');
console.log('\n📱 Your Order Details:');
console.log('   Phone: +965 67091345');
console.log('   Order: 20 Roses');
console.log('   Amount: ₹1000');
console.log('   Status: CONFIRMED');
console.log('   Delivery Boy: Ahmed');
console.log('\n🧪 Now send "No delivery today" to see:');
console.log('   1. Order status → CANCELED');
console.log('   2. Inventory → Roses +20');
console.log('   3. Delivery boy (Ahmed) gets notification');
console.log('   4. You get confirmation');
console.log('\n📊 Open Excel and refresh to see changes in real-time!');


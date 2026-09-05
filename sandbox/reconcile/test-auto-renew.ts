import { openDb } from '../../src/business/db';
import { autoRenewDueSubscriptions } from '../../src/business/renewal';

const db = openDb('sandbox/reconcile/test-db2.sqlite');
const result = autoRenewDueSubscriptions(db, '2026-08-11');
console.log('renewed:', result.renewed.length);
console.log('flagged:', result.flagged.length);
console.log('sample renewed:', JSON.stringify(result.renewed.slice(0, 5), null, 2));
console.log('sample flagged:', JSON.stringify(result.flagged.slice(0, 5), null, 2));

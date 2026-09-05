import { openDb } from '../../src/business/db';
import { autoRenewDueSubscriptions } from '../../src/business/renewal';
import { todayIST } from '../../src/business/dates';

const db = openDb('./data/business.db');
const today = todayIST();
const result = autoRenewDueSubscriptions(db, today);
console.log(`today (IST): ${today}`);
console.log('renewed:', result.renewed.length);
console.log('flagged:', result.flagged.length);

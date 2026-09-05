import { openDb } from '../../src/business/db';
import { autoRenewDueSubscriptions, flagDormantForReview } from '../../src/business/renewal';
import { todayIST } from '../../src/business/dates';

const db = openDb('./data/business.db');
const today = todayIST();
const result = autoRenewDueSubscriptions(db, today);
console.log('renewed (should be 0, already applied earlier today):', result.renewed.length);
console.log('flagged:', result.flagged.length);
const created = flagDormantForReview(db, result.flagged, new Date().toISOString());
console.log('newly surfaced on dashboard Review queue:', created);

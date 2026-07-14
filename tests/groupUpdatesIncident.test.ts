import { describe, expect, it } from 'vitest';
import { openDb } from '../src/business/db';
import { insertGroupMessage, processGroupMessages } from '../src/business/groupUpdates';

const INCIDENT_DATE = '2026-07-14';

/** The 28 messages that produced the unsafe 15-Jul sheet. */
const JULY_14_MESSAGES = [
  'Hold Smita Mathur',
  'Skip one week for Chhavi Sharma',
  'Send replacement of sunflowers to Samta Mehra',
  'Samta Mehta — mix of 3 flowers always',
  `From Faisal Khan today
Immediately
To
Saif Khan, P-604, Emaar Enclave, Sector-66
Ph - 9892055569
10 mix oriental
15 shaded purple carnations
Gypso, limonium and greens
Bouquet in simple Korean wrap
Do not ask for payment`,
  `Tomorrow morning from Vidhi Jain
To
Recipient's Name Lalit Jain
Number - 9910866119
Address - C 902, GPL Eden Heights, Sec 70 Gurgaon-122101
Message - Happy Birthday Papa`,
  'Pls send flowers of saloni Mevawala tomorroe',
  'Send some extra flowers to Asha Esther next',
  'Send tomorrow morning\n2 oriental lilies to Ridhi heritage\n+91 98730 38855',
  'Divya Sabharwal\nSend replacement tomorrow',
  'Pink lilies',
  'Hold swapnil',
  'Renew Aditi Bhatt',
  'Send one basket of 1500 to Scottish school tomorrow by 9am..',
  'Send replacement of sunflowers to Nandini Kar tomorrow',
  `Send today by 11:30 to
One point one 16 office
Total stems 25- shaded purple carnations plus Rajnigandha
In tissue wrap
Address: 161sp, basement, Sector 51, Gurgaon
bouquet 1200/-`,
  'Vandana Dutt\nStart subscription\nSend one delivery today instead of 16th\nSend after 2:30',
  'Send immediately to Maneesha Chaturvedi\n4 pink oriental lilies\n2 green spray daisies\n2 yellow spray daisies\n2 white spray daisies',
  'Start Namrata Khandelwal from Thursday',
  `From Srishti Makhija today
2 pink oriental lilies in brown wrap
Amount 700
Need to send to
Nimisha
+91 9829636216
W2B 103 Wellington estate 2
Near One Horizon Center
Message
Hope this puts some sprinkle in your empty cup.`,
  'Before 2:30',
  `From DanielleGoogle today before 3
To
E-44, Westend heights, St Thomas Marg, near Genpact India,
DLF Phase 5, Sector 53, Gurugram - 122002
Mob. no. - +91 98817 30945
Message
Dear Karan, Happy Birthday!`,
  '@161847957311493\nSend after 5',
  '1201 t a Palm drive sector 66\n9811998878\nPlease send today\n05:00 pm\nPaytm done 3400',
  'Rose mala tomorrows',
  'Sonia kalra visit tomorrow between 7 to 8pm',
  'Sharmistha Jhulka — So for this Thursday\n8 bright nice oriental lilies\nMogra - one bunch\nBop — 4 pcs\nLotus flower - 6',
  'Samia\nStart with Joy from Saturday\n+91 99100 22591'
];

describe('July 14 Updates incident regression', () => {
  it('processes all evidence without unsafe subscription or spurious order mutations', async () => {
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO customers (id, name, phones, address, zone)
                VALUES ('3293', 'Asha Esther Jai Kishan', '9871533860', 'Victory Valley', 'Badshahpur')`).run();
    db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, status)
                VALUES (1187, '3293', 'Joy', 1950, 'WEEKLY', 'Monday', 'HOLD')`).run();
    db.prepare(`INSERT INTO customers (id, name, phones, address, zone)
                VALUES ('77', 'Maneesha Chaturvedi', '9971153076', 'Sushant Lok', 'M G Road')`).run();
    db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, status)
                VALUES (465, '77', 'Joy', 1950, 'WEEKLY', 'Saturday', 'HOLD')`).run();

    JULY_14_MESSAGES.forEach((message, index) => {
      insertGroupMessage(db, 'staff', message, `2026-07-14T10:${String(index).padStart(2, '0')}:00.000Z`);
    });

    const result = await processGroupMessages(db, INCIDENT_DATE);
    const orders = db.prepare(`SELECT * FROM one_time_orders ORDER BY id`).all() as Array<{
      customer_name: string;
      phone: string;
      date: string;
      amount: number;
    }>;

    expect(result.processed).toBe(28);
    expect((db.prepare(`SELECT status FROM subscriptions WHERE id = 1187`).get() as { status: string }).status).toBe('HOLD');
    expect((db.prepare(`SELECT status FROM subscriptions WHERE id = 465`).get() as { status: string }).status).toBe('HOLD');
    expect(orders).toHaveLength(2);
    expect(orders).toEqual(expect.arrayContaining([
      expect.objectContaining({ customer_name: 'Saif Khan', phone: '9892055569', date: INCIDENT_DATE }),
      expect.objectContaining({ customer_name: 'Nimisha', phone: '9829636216', date: INCIDENT_DATE, amount: 700 })
    ]));
    expect(orders.some(order => order.phone === '7957311493')).toBe(false);
    expect(orders.some(order => order.phone === '9910022591')).toBe(false);
  });
});

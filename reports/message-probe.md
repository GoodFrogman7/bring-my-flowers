# Message corpus probe

Each message ran alone through `processGroupMessages` on a fresh in-memory DB (today = 2026-09-23, Ollama off). Verdicts: SAFE_REVIEW = sent to Review with no change; UNSAFE_MUTATION = changed data although the message needs a human; NEEDS_CHECK = changed data — compare the changes with the expected action; NOT_ACTED = logged but nothing changed and nothing escalated.

Totals: SAFE_REVIEW 9 · NEEDS_CHECK 1

| id | type | pipeline classification | escalated | what happened | expected |
|---|---|---|---|---|---|
| c01 | SLOT_CONSTRAINT | UNCLEAR | yes | SAFE_REVIEW: No deterministic customer, complete order, or recognizable action found | Set time slot 'before 11:30' on the order it replies to |
| c02 | PAYMENT_RECORD | UNCLEAR | yes | SAFE_REVIEW: No deterministic customer, complete order, or recognizable action found | Payments recorded for subscriptions delivered on those dates — exact meaning unconfirmed; human confirms |
| c03 | HOLD_OPEN | CUSTOMER_UPDATE | no | NEEDS_CHECK: ~ customer 9001 (Meera Kapoor): address="House 9001, Sample Society" remarks="" extra="" → address="House 9001, Sample Society" remarks="Hold till further notice (23/09)" extra=""<br>~ subscription of 9001: status=ACTIVE day=Friday day2= slot="" → status=HOLD day=Friday day2= slot="" | Hold Meera Kapoor — open-ended or one day is unconfirmed |
| c04 | HOLD_UNTIL_PAID | UNCLEAR | yes | SAFE_REVIEW: No customer matching "Hdtnp ⏎ Anita Rao" | Anita Rao and Vikram Shah: HOLD – confirm payment on the sheet, staff notes carried into remarks |
| c05 | COLLECTION_LIST | UNCLEAR | yes | SAFE_REVIEW: No deterministic customer, complete order, or recognizable action found | Set collect flag and amount due on Anita Rao and Rohan Mehta rows; never mark anything paid |
| c06 | NEW_SUBSCRIPTION | UNCLEAR | yes | SAFE_REVIEW: Subscription start/change requires manual confirmation | New subscription: Kavya Nair, Bliss, starting Sunday 2026-09-27 |
| c07 | ONE_OFF_ORDER | UNCLEAR | yes | SAFE_REVIEW: Incomplete order — missing product details | Paid one-off order today: ₹1600 received, sender Pooja Batra, recipient Neha Arora 9000000007, card 'Happy birthday!' |
| c08 | NEW_SUBSCRIPTION | UNCLEAR | yes | SAFE_REVIEW: Subscription start/change requires manual confirmation | New subscription: Arjun Sethi, Bliss, starting Friday 2026-09-25 |
| c09 | ONE_OFF_ORDER | UNCLEAR | yes | SAFE_REVIEW: Incomplete order — missing product details | One-off order today, cash on delivery ₹600, recipient Tanvi Gupta, address without the 'Please deliver to' prefix |
| c10 | PAUSE_DATES | UNCLEAR | yes | SAFE_REVIEW: No deterministic customer, complete order, or recognizable action found | Skip Isha Malhotra's deliveries on 2026-09-26 and 2026-09-29, resume 2026-10-03 |

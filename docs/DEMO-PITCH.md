# Bring My Flowers — Demo & Funding Pitch (30 min)

**Audience:** client / investor-style walkthrough  
**Tone:** calm, specific, honest — ops software for a real flower-subscription shop, not a hype chatbot deck.

**Before you start (5 min):**
1. Bot running (`Bring My Flowers` Desktop shortcut or scheduled task)
2. Hard-refresh http://localhost:8787
3. Confirm banner green / WhatsApp connected with number showing in Settings
4. Optional second tab ready: http://localhost:8787/architecture
5. Close unrelated windows; hide browser bookmarks; full-screen the app window

---

## Opening (45–60 seconds)

> “Bring My Flowers is a flower-subscription operation in Gurgaon — roughly fifty to eighty deliveries a day, managed today on WhatsApp and a heavy Excel master.
>
> What I built is **not** a generic customer chatbot. It’s an **ops console** for the owner: staff keep posting updates in WhatsApp the way they already do; the system structures that into a database, regenerates tomorrow’s delivery sheet, and gives the owner a local app for deliveries, money, and exceptions — without flooding anyone’s personal inbox.”

**Pause. Open the dashboard.**

---

## Demo flow (12–15 minutes)

### 1. Home / Overview (~2 min)

**Say:**

> “This is what the owner opens every morning. Live connection status up top. Tomorrow’s delivery load, revenue, and what needs collecting. Zone breakdown so they can see load by area without opening Excel first.”

**Click:** Overview pulse card, glance at the six cards, mention Download tomorrow’s sheet.

**Do:** Click **Download tomorrow’s sheet** once so they see the Excel artifact.

**Say:**

> “The sheet format matches how the shop already works — this isn’t a parallel system they have to abandon. Partial auto flower assignment handles packs we know how to recipe; premium/custom rows stay manual, which is intentional.”

### 2. Money (~2 min)

**Say:**

> “Pending collections and renewals to chase — the cash discipline layer. Staff still message customers; this shows *who* and *how much* without digging through chats.”

### 3. Review (~2 min)

**Say:**

> “WhatsApp Updates are messy — names misspelled, incomplete one-offs. Anything the bot refuses to auto-apply lands here with a **reason** and a suggested action. Safety first: ambiguous messages don’t silently rewrite the database.”

### 4. Ask the bot (~2 min) — live Q&A

Type one of:
- `How many deliveries tomorrow?`
- `Who owes the most?`

**Say:**

> “Same intelligence as the group bot. When Claude is configured, it answers with **read-only** database tools — it cannot invent a hold or mark someone paid. That’s a deliberate safety rail.”

### 5. Settings / WhatsApp (~2 min)

**Say:**

> “WhatsApp stays quiet unless someone calls the bot — `Bot,` or `Flower Bot,` in the Updates group. Sheets go to the **group** at night for staff; personal DMs to the owner are off. Here’s the linked number — so they always know which device is running the bot — and the QR path if they ever need to swap phones.”

### 6. Architecture page (~2 min) — honesty slide

Open `/architecture`.

**Say:**

> “Six months ago I sketched Twilio, Sheets, Razorpay, Whisper. That code still exists as a **prototype mode**. What ships for this business is this path: Updates group → local bot → SQLite → Excel sheet → owner console. I want funding / partnership based on what’s running — not a diagram of intentions.”

---

## What to ask for (choose one frame)

### If fundraising / investment
> “I’m looking for capital and distribution partners to harden the next milestones — route building for delivery boys, automated payment message send, and feedback-loop intake — while keeping the same shop-first model.”

### If selling as a client product / pilot
> “I’d like a paid pilot: run this on your ops machine for N weeks, measure time saved on sheet prep and collection chase, then decide on a license + support fee.”

---

## Closing (30 seconds)

> “The hard problem here isn’t ‘add AI.’ It’s respecting a working WhatsApp + Excel workflow and still giving the owner control, auditability, and a tomorrow sheet that the floor can trust. Happy to take questions.”

---

## Anticipated Q&A (honest answers)

| Question | Answer |
|----------|--------|
| Is this live for real customers DMing the bot? | **No.** Default path is staff Updates group only. Personal chats are ignored on purpose. |
| Does it take payments? | **Not in production.** Collections are tracked in SQLite; Razorpay exists only in a separate prototype mode. |
| Can AI change orders? | **No.** Cloud Q&A is read-only. Mutations come from conservative parsers + staff messages. |
| What if WhatsApp logs out? | Owner sees a red banner; process exits and the Windows task relaunches so they can re-scan QR on Settings / Link. |
| Cloud / SaaS? | Baileys linked-device model means the bot stays on the owner’s PC for now. That’s a product constraint, not a bug. |
| Scale? | Built against a 16k-row master and ~50–80 deliveries/day; tested with 300+ automated tests and a real-sheet shadow check. |
| What’s next? | Route assignment → feedback automation → auto-send payment drafts. |

---

## Words to avoid

- “Revolutionary,” “disrupting floristry,” “full AI agent”
- Claiming Twilio / Razorpay / voice as today’s production path
- “Fully automated” flower assignment (say *partial*; manual where recipes don’t exist)

## Words to lean on

- Ops console · worksheet continuity · safety / escalation · owner control · local + privacy · on-demand bot calls

---

## One-liner for a slide or first message

> Local ops software that turns a flower shop’s WhatsApp Updates group into tomorrow’s delivery sheet — with an owner dashboard for money, review, and answers — without personal-chat spam.

---

## Demo checklist (print / phone notes)

- [ ] Bot green / number visible in Settings  
- [ ] Download sheet works  
- [ ] One Ask-the-bot question works  
- [ ] Review tab open (even if empty — still explain)  
- [ ] Architecture tab ready for the honesty beat  
- [ ] Ask clear: pilot fee / funding amount / next call  

**Time box:** Open 1 → Demo 12 → Ask & close 5 → Q&A remainder.

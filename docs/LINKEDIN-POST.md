# LinkedIn post — ready to submit

**Suggested attachments (screenshot these locally):**
1. Owner console home — http://localhost:8787 (hard refresh)
2. Honest architecture — http://localhost:8787/architecture
3. Optional hero — `docs/assets/linkedin-hero-architecture.png`

---

## Post copy (paste as-is, tweak voice if you want)

Six months ago I shared an architecture diagram for Bring My Flowers — Twilio webhooks, Google Sheets, Razorpay, Whisper, multi-language support.

Honest update: that stack exists as a **prototype mode** in the repo. What I actually shipped for the real business is different — and more useful to the owner.

**Bring My Flowers** is a flower-subscription operation in Gurgaon (~50–80 daily deliveries, 16k-row master workbook). The team lives in WhatsApp and Excel. My job wasn't to replace that overnight — it was to automate the painful middle.

### What's live today

→ Staff post holds, resumes, and one-offs in a WhatsApp **Updates group** (Hinglish, messy, real)

→ A local bot **stages** everything and applies it on a nightly cron (21:30 IST)

→ Subscription data lives in **SQLite** (imported from the owner's 63-column master)

→ The bot regenerates the **delivery sheet** in the exact Excel format the shop already uses — partial auto flower assignment (restrictions, no-repeat last 5, cheapest stem)

→ An **owner console** on localhost: deliveries, pending payments, review queue, sheet download, WhatsApp QR linking

→ **On-demand Q&A** when staff call the bot (`Bot, how many deliveries tomorrow?`) — Claude with read-only database tools; it cannot change orders or payments

→ **331 automated tests**; shadow-tested against a real July delivery sheet (72/77 rows reproduced)

### What I deliberately did NOT claim

✗ Customer-facing Twilio commerce bot (different mode)

✗ Razorpay payment links in production

✗ Voice ordering / 4-language support in this deployment

✗ Auto route building (owner still assigns delivery boys)

✗ Auto-sending payment messages to customers (drafts work; send is manual)

### What's next

Route building, feedback loop automation, and payment message send — in that order of business value.

The lesson: the first diagram was a **product vision**. The second is a **working ops system** the owner can run from a Windows desktop without touching a terminal.

Built with Node.js, TypeScript, Baileys, SQLite, and Claude (read-only tools).

If you're automating a business that already has a workflow (not greenfield SaaS), meet the team where they are — WhatsApp + Excel — then pull intelligence into a dashboard.

#BuildInPublic #Automation #WhatsApp #TypeScript #AI #SmallBusiness #SoftwareEngineering

---

## Short version (if you prefer concise)

Six months ago I diagrammed Twilio + Sheets + Razorpay for Bring My Flowers.

Reality check: the **production** system is local ops automation for a Gurgaon flower-subscription shop.

WhatsApp Updates group → SQLite → Excel delivery sheet → owner dashboard.

Bot stays quiet unless staff call it. Claude answers questions with read-only tools. 331 tests.

The Twilio/Razorpay/voice stack? Prototype mode — not what the owner runs daily.

Meet messy workflows where they are. Automate the middle. Ship honestly.

#BuildInPublic #Automation #TypeScript #AI

---

## Carousel slide order (optional)

1. Hero image (`docs/assets/linkedin-hero-architecture.png`)
2. Old vs new: "Vision (2025) vs Shipped (2026)" — screenshot `/architecture`
3. Owner console home — screenshot `/`
4. Bullet: What's live / What's not / What's next (text slide or screenshot Settings tab)

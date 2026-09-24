# WhatsApp strategy: remove it from the critical path

Checked 2026-09-05.

## Decision

The recommended operating mode is now **dashboard-first**:

```text
Staff message -> paste into dashboard -> explicit Apply -> SQLite -> Excel sheet
                                           |
                                           -> Review when the message is unclear
```

WhatsApp can remain on the staff phones and can still be enabled as a legacy
Updates-group adapter, but the shop no longer needs a WhatsApp login, QR scan,
group JID, public webhook, or second AI service to prepare tomorrow's work.

## First-principles questions

### What is the real job?

Produce an accurate delivery sheet, carry forward subscriptions safely, record
staff changes, and show a human what needs a decision.

### What is the source of truth?

SQLite. WhatsApp, pasted text, and Excel are interfaces or artifacts. None of
them should be required to keep the business data safe.

### What is WhatsApp actually adding?

Convenient message intake and a place to notify staff. It is not inherently
needed for renewal math, flower history, review escalation, or sheet generation.

### What is causing the recurring pain?

The existing group path couples daily operations to a QR-linked WhatsApp Web
session. Baileys describes itself as an unofficial WhatsApp Web API and warns
that it is not affiliated with WhatsApp; its WebSocket/session behavior can
break when WhatsApp changes. That makes reconnect and QR fixes useful patches,
not a durable foundation. See the [Baileys repository and disclaimer](https://github.com/WhiskeySockets/Baileys).

## Options and trade-offs

| Option | Reliability for the uncle | Setup | Keeps the existing group? | Decision |
|---|---|---|---|---|
| Dashboard paste/apply | Highest; local and explicit | One shortcut | No | **Use now** |
| Official Meta Cloud API | High after setup | Business portfolio, WABA, business phone, HTTPS webhook, tokens | Not automatically | Consider later for a dedicated staff inbox |
| Baileys Updates group | Lowest; QR/session dependent | Phone link + group JID | Yes | Keep optional for transition only |

Meta's official WhatsApp Business Platform exposes Cloud API capabilities for
systems that send and receive messages, but it requires Meta business setup and
webhook plumbing. See [Meta's official WhatsApp Business Platform documentation](https://www.postman.com/meta/whatsapp-business-platform/overview/)
and the [Cloud API reference](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-b37ef0a5-f8be-4e42-bfd0-3557a7d6b754).

It also should not be treated as a drop-in replacement for this exact existing
group without checking eligibility and configuration. WhatsApp's own help
material notes that business group-chat behavior can differ from ordinary
groups; see [Business group chats](https://faq.whatsapp.com/1168258858576291).

## What changed in the product

- `BUSINESS_TRANSPORT=dashboard` is the default in the business template.
- Dashboard mode never constructs or starts `WhatsAppBot`.
- The same conservative parser is used for pasted updates and group messages.
- **Apply this update** stages the exact text, runs the existing transaction-safe
  processor, renews eligible subscriptions, flags dormant ones, and prepares
  tomorrow's sheet.
- Unclear messages are not guessed; they appear in Review.
- The nightly job still runs without WhatsApp and writes the next-day sheet.
- Baileys remains available only when an owner deliberately sets
  `BUSINESS_TRANSPORT=baileys` and `UPDATES_GROUP_JID`.
- When Baileys is on, the bot is a **silent listener** (`GROUP_SILENT=1`, the
  default since 2026-09-23). It stores every Updates-group message but posts
  nothing to any group: no nightly sheet, no summary, no `Bot,` replies. The
  Baileys transport itself refuses group sends while this is on, so no code
  path can post by accident. Questions move to the owner console.

## Uncle's daily workflow

1. Open **Bring My Flowers** from the Desktop.
2. Paste the exact staff update on Overview.
3. Click **Apply this update**.
4. If the app says something needs Review, open Review and decide manually.
5. Click **Download tomorrow's sheet**.

If there are no changes, skip straight to the sheet. If WhatsApp is down, do
not troubleshoot it before doing the work; keep operating in the dashboard.

## Safe migration plan

1. Run dashboard mode for one week with real staff updates copied from the
   existing group.
2. Compare the generated sheet and Review queue with the current process.
3. Keep Baileys off unless the team proves that group convenience is worth the
   operational cost.
4. If the team later wants messaging automation, pilot an official Cloud API
   staff inbox separately. Do not make that pilot a prerequisite for the sheet.

## Explicit non-goals

- Do not make an LLM responsible for changing payments or subscriptions.
- Do not make the dashboard silently guess ambiguous names or actions.
- Do not make the uncle maintain QR sessions, group IDs, ngrok tunnels, or
  access tokens for the basic product.
- Do not replace SQLite with an Excel workbook just because the team consumes
  an Excel sheet.

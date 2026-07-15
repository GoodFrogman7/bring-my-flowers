/**
 * Honest system architecture — screenshot at /architecture for LinkedIn.
 * Shows what business mode actually ships; prototype modes are labeled separately.
 */
export const ARCHITECTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bring My Flowers — Architecture (Business Mode)</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0c1210;
    --panel: #141c19;
    --panel-2: #1a2420;
    --line: rgba(255,255,255,0.08);
    --text: #e8f0ec;
    --muted: #8fa399;
    --green: #3d9b72;
    --green-soft: rgba(61,155,114,0.15);
    --rose: #d4727f;
    --rose-soft: rgba(212,114,127,0.12);
    --gold: #c9a56a;
    --gold-soft: rgba(201,165,106,0.12);
    --blue: #6ba3c7;
    --serif: "Instrument Serif", Georgia, serif;
    --sans: "DM Sans", system-ui, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh; font-family: var(--sans); color: var(--text);
    background:
      radial-gradient(900px 500px at 15% -5%, rgba(212,114,127,0.18), transparent 55%),
      radial-gradient(700px 400px at 95% 10%, rgba(61,155,114,0.12), transparent 50%),
      var(--bg);
    padding: 48px 40px 56px;
  }
  .wrap { max-width: 1180px; margin: 0 auto; }
  header { margin-bottom: 36px; }
  .eyebrow {
    font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--gold); font-weight: 600; margin-bottom: 10px;
  }
  h1 {
    font-family: var(--serif); font-size: clamp(2rem, 4vw, 2.75rem);
    font-weight: 400; letter-spacing: -0.02em; line-height: 1.1;
  }
  .sub { color: var(--muted); margin-top: 10px; max-width: 62ch; font-size: 15px; line-height: 1.6; }
  .legend {
    display: flex; gap: 18px; flex-wrap: wrap; margin: 28px 0 32px;
    font-size: 12px; color: var(--muted);
  }
  .legend span { display: inline-flex; align-items: center; gap: 8px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .dot.live { background: var(--green); box-shadow: 0 0 12px rgba(61,155,114,0.6); }
  .dot.future { background: var(--gold); opacity: 0.7; }
  .dot.proto { background: var(--muted); opacity: 0.5; }
  .grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
  }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .col-title {
    font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--muted); margin-bottom: 14px; font-weight: 600;
  }
  .flow { display: flex; flex-direction: column; gap: 0; }
  .node {
    background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
    padding: 16px 18px; position: relative;
  }
  .node.live { border-color: rgba(61,155,114,0.35); background: linear-gradient(135deg, var(--panel), var(--green-soft)); }
  .node.future { border-color: rgba(201,165,106,0.3); background: linear-gradient(135deg, var(--panel), var(--gold-soft)); }
  .node.proto { opacity: 0.55; border-style: dashed; }
  .node h3 { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
  .node p { font-size: 13px; color: var(--muted); line-height: 1.45; }
  .tag {
    display: inline-block; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
    padding: 3px 8px; border-radius: 999px; margin-bottom: 8px; font-weight: 600;
  }
  .tag.live { background: var(--green-soft); color: #7fd4a8; }
  .tag.future { background: var(--gold-soft); color: var(--gold); }
  .tag.proto { background: rgba(255,255,255,0.06); color: var(--muted); }
  .arrow {
    display: flex; justify-content: center; padding: 6px 0; color: var(--muted); font-size: 18px;
  }
  .branch-row {
    display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;
  }
  .branch-row .node { padding: 12px 14px; }
  .branch-row .node h3 { font-size: 13px; }
  .branch-row .node p { font-size: 12px; }
  .footer-note {
    margin-top: 32px; padding: 18px 20px; border-radius: 14px;
    background: var(--panel-2); border: 1px solid var(--line);
    font-size: 13px; color: var(--muted); line-height: 1.55;
  }
  .footer-note strong { color: var(--text); }
  .metrics {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 28px;
  }
  @media (max-width: 700px) { .metrics { grid-template-columns: repeat(2, 1fr); } }
  .metric {
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 14px 16px; text-align: center;
  }
  .metric .val { font-family: var(--serif); font-size: 1.6rem; color: var(--rose); }
  .metric .lbl { font-size: 11px; color: var(--muted); margin-top: 4px; letter-spacing: 0.06em; text-transform: uppercase; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="eyebrow">Bring My Flowers · Business mode · 2026</div>
    <h1>From staff WhatsApp chaos to a local ops console</h1>
    <p class="sub">What actually ships today for a Gurgaon flower-subscription shop (~50–80 daily deliveries, 16k-row master). Not the Twilio/Razorpay prototype — that lives in a separate mode.</p>
  </header>

  <div class="legend">
    <span><i class="dot live"></i> Shipped &amp; in production path</span>
    <span><i class="dot future"></i> On roadmap / partial</span>
    <span><i class="dot proto"></i> Prototype only (enhanced mode)</span>
  </div>

  <div class="grid">
    <div>
      <div class="col-title">Production path (business mode)</div>
      <div class="flow">
        <div class="node live">
          <span class="tag live">Live</span>
          <h3>Staff Updates group (WhatsApp)</h3>
          <p>Holds, resumes, one-offs posted in Hinglish. Bot stays quiet unless called: <em>Bot, …</em> or <em>Bot, send sheet</em>.</p>
        </div>
        <div class="arrow">↓</div>
        <div class="node live">
          <span class="tag live">Live</span>
          <h3>Bot server (Node.js + TypeScript, local)</h3>
          <p>Baileys WhatsApp Web. Stages every group message. Nightly cron (21:30 IST) parses &amp; applies updates.</p>
        </div>
        <div class="arrow">↓</div>
        <div class="node live">
          <span class="tag live">Live</span>
          <h3>SQLite business datastore</h3>
          <p>Customers, subscriptions, cycles, deliveries, restrictions, delivery history. Imported from 63-col master workbook.</p>
        </div>
        <div class="arrow">↓</div>
        <div class="node live">
          <span class="tag live">Live</span>
          <h3>Delivery sheet generator (.xlsx)</h3>
          <p>Owner's 30-column format + Procurement tab. Partial auto flower assignment (restrictions, no-repeat, cheapest stem).</p>
        </div>
        <div class="arrow">↓</div>
        <div class="node live">
          <span class="tag live">Live</span>
          <h3>Owner console (localhost:8787)</h3>
          <p>Deliveries, pending payments, review queue, sheet download, WhatsApp QR, read-only AI Q&amp;A.</p>
        </div>
      </div>
    </div>

    <div>
      <div class="col-title">Side paths &amp; what's next</div>
      <div class="flow">
        <div class="node live">
          <span class="tag live">Live</span>
          <h3>On-demand Q&amp;A</h3>
          <p>Claude/OpenAI with read-only DB tools → local tools → Ollama fallback. Cannot mutate orders or payments.</p>
        </div>
        <div class="arrow">↓</div>
        <div class="node future">
          <span class="tag future">Partial</span>
          <h3>Payment message drafts</h3>
          <p>Two Pooja templates generated from sheet data. Preview works; auto-send to customers not wired yet.</p>
        </div>
        <div class="arrow">↓</div>
        <div class="node future">
          <span class="tag future">Roadmap</span>
          <h3>Route building</h3>
          <p>Owner still assigns delivery boys manually. Explicit next milestone from shop walkthrough.</p>
        </div>
        <div class="arrow">↓</div>
        <div class="node future">
          <span class="tag future">Roadmap</span>
          <h3>Feedback loop automation</h3>
          <p>Feedback workbook import exists (CLI). Nightly ingest from WhatsApp not built.</p>
        </div>
      </div>

      <div style="margin-top:24px" class="col-title">Prototype stack (separate enhanced mode — not this deployment)</div>
      <div class="branch-row">
        <div class="node proto"><span class="tag proto">Proto</span><h3>Twilio WhatsApp</h3><p>Webhook bot for 1:1 orders</p></div>
        <div class="node proto"><span class="tag proto">Proto</span><h3>Google Sheets</h3><p>Live inventory storage</p></div>
        <div class="node proto"><span class="tag proto">Proto</span><h3>Razorpay</h3><p>Payment links + webhooks</p></div>
        <div class="node proto"><span class="tag proto">Proto</span><h3>Whisper + i18n</h3><p>Voice orders, 4 languages</p></div>
      </div>
    </div>
  </div>

  <div class="metrics">
    <div class="metric"><div class="val">331</div><div class="lbl">Automated tests</div></div>
    <div class="metric"><div class="val">72/77</div><div class="lbl">Sheet shadow-test rows</div></div>
    <div class="metric"><div class="val">~16k</div><div class="lbl">Master workbook rows</div></div>
    <div class="metric"><div class="val">21:30</div><div class="lbl">Nightly IST cron</div></div>
  </div>

  <div class="footer-note">
    <strong>Honest scope:</strong> This is ops automation for a real subscription florist — not a generic e-commerce chatbot.
    The old architecture diagram showed customer-facing Twilio + Razorpay + Sheets. That code exists as a prototype.
    What the owner uses daily is: <strong>group → SQLite → Excel sheet → local dashboard</strong>.
  </div>
</div>
</body>
</html>`;

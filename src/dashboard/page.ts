/**
 * Owner console — premium ops UI for screenshots + daily owner use.
 * Inline HTML/CSS/JS so business mode ships zero static build step.
 */
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f1714">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40;700&display=swap" rel="stylesheet">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<title>Bring My Flowers — Owner Console</title>
<style>
  :root {
    --ink: #0f1714;
    --ink-2: #1e2b26;
    --ink-soft: #4a5c55;
    --muted: #7a8f86;
    --paper: #f4f7f5;
    --paper-2: #e8eeea;
    --white: #ffffff;
    --line: rgba(15, 23, 20, 0.08);
    --brand: #1a2e28;
    --accent: #c45c6a;
    --accent-2: #d4727f;
    --gold: #b8956c;
    --ok: #2a7a5a;
    --ok-bg: #e6f4ed;
    --warn: #9b3a3a;
    --warn-bg: #fceeee;
    --shadow-sm: 0 2px 8px rgba(15,23,20,0.04);
    --shadow: 0 20px 60px rgba(15,23,20,0.08);
    --shadow-lg: 0 32px 80px rgba(15,23,20,0.12);
    --radius: 18px;
    --serif: "Instrument Serif", Georgia, serif;
    --sans: "DM Sans", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; min-height: 100vh; color: var(--ink);
    font-family: var(--sans); font-size: 15px; line-height: 1.55;
    background: var(--paper);
    background-image:
      radial-gradient(ellipse 80% 50% at 0% -10%, rgba(196,92,106,0.09), transparent),
      radial-gradient(ellipse 60% 40% at 100% 0%, rgba(184,149,106,0.08), transparent);
  }
  #status-banner {
    display: none; padding: 11px 28px; font-size: 13px; font-weight: 500;
    background: var(--warn-bg); color: var(--warn); border-bottom: 1px solid rgba(155,58,58,0.12);
  }
  #status-banner.ok { background: var(--ok-bg); color: var(--ok); border-color: rgba(42,122,90,0.15); }
  #status-banner a { color: inherit; font-weight: 600; }

  .topbar {
    position: sticky; top: 0; z-index: 40;
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px 28px; background: rgba(244,247,245,0.82);
    backdrop-filter: blur(16px); border-bottom: 1px solid var(--line);
  }
  .topbar-brand { display: flex; align-items: center; gap: 12px; }
  .topbar-mark {
    width: 36px; height: 36px; border-radius: 10px;
    background: linear-gradient(145deg, var(--brand), #2a4239);
    display: grid; place-items: center; box-shadow: var(--shadow-sm);
  }
  .topbar-mark svg { width: 18px; height: 18px; }
  .topbar-title { font-family: var(--serif); font-size: 1.15rem; font-weight: 400; letter-spacing: -0.01em; }
  .topbar-pills { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .pill {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
    padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line);
    background: var(--white); color: var(--ink-soft);
  }
  .pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
  .pill.ok .dot { background: var(--ok); box-shadow: 0 0 8px rgba(42,122,90,0.5); }
  .pill.warn .dot { background: var(--warn); }
  .pill.ai { border-color: rgba(196,92,106,0.2); color: var(--accent); }

  .shell { max-width: 1240px; margin: 0 auto; padding: 32px 28px 120px; }

  .hero-grid {
    display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 24px;
    margin-bottom: 32px; animation: fadeUp 0.6s ease both;
  }
  @media (max-width: 960px) { .hero-grid { grid-template-columns: 1fr; } }
  .hero-copy .eyebrow {
    font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;
    color: var(--gold); font-weight: 600; margin-bottom: 12px;
  }
  .hero-copy h1 {
    font-family: var(--serif); font-size: clamp(2.2rem, 4.5vw, 3.2rem);
    font-weight: 400; line-height: 1.05; letter-spacing: -0.03em; margin: 0 0 14px;
  }
  .hero-copy .lead { color: var(--muted); font-size: 16px; max-width: 38ch; font-weight: 400; margin-bottom: 20px; }
  .hero-stats { display: flex; gap: 24px; flex-wrap: wrap; }
  .hero-stat .num { font-family: var(--serif); font-size: 1.75rem; color: var(--brand); line-height: 1; }
  .hero-stat .lbl { font-size: 11px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; margin-top: 4px; }

  .pulse-card {
    background: linear-gradient(155deg, var(--ink) 0%, var(--ink-2) 100%);
    border-radius: calc(var(--radius) + 4px); padding: 28px 28px 24px;
    color: #eef5f1; box-shadow: var(--shadow-lg);
    position: relative; overflow: hidden;
  }
  .pulse-card::before {
    content: ""; position: absolute; top: -40%; right: -20%;
    width: 280px; height: 280px; border-radius: 50%;
    background: radial-gradient(circle, rgba(196,92,106,0.25), transparent 70%);
  }
  .pulse-card .label {
    font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
    color: rgba(238,245,241,0.55); font-weight: 600; position: relative;
  }
  .pulse-card .big {
    font-family: var(--serif); font-size: 3.5rem; font-weight: 400;
    line-height: 1; margin: 8px 0 4px; position: relative; letter-spacing: -0.03em;
  }
  .pulse-card .sub { font-size: 14px; color: rgba(238,245,241,0.65); position: relative; margin-bottom: 20px; }
  .pulse-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; position: relative; }
  .pulse-metric {
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px; padding: 12px 14px;
  }
  .pulse-metric .v { font-size: 1.25rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .pulse-metric .l { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(238,245,241,0.5); margin-top: 2px; }
  .zone-bars { margin-top: 18px; position: relative; }
  .zone-bars .title { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(238,245,241,0.45); margin-bottom: 10px; }
  .zone-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 12px; }
  .zone-row .name { width: 72px; color: rgba(238,245,241,0.7); flex-shrink: 0; }
  .zone-row .bar-wrap { flex: 1; height: 6px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden; }
  .zone-row .bar { height: 100%; background: linear-gradient(90deg, var(--accent-2), var(--gold)); border-radius: 999px; transition: width 0.6s ease; }
  .zone-row .count { width: 28px; text-align: right; color: rgba(238,245,241,0.6); font-variant-numeric: tabular-nums; }

  nav.tabs {
    display: flex; gap: 2px; padding: 5px; margin-bottom: 28px;
    background: var(--white); border: 1px solid var(--line);
    border-radius: 14px; box-shadow: var(--shadow-sm);
    animation: fadeUp 0.65s ease 0.05s both;
  }
  nav.tabs button {
    flex: 1; min-width: 0; appearance: none; border: 0; background: transparent;
    font-family: var(--sans); font-size: 13px; font-weight: 500; color: var(--muted);
    padding: 12px 10px; border-radius: 10px; cursor: pointer; transition: all 0.2s;
  }
  nav.tabs button:hover { color: var(--ink); background: var(--paper); }
  nav.tabs button.active { background: var(--brand); color: #f4faf7; box-shadow: var(--shadow-sm); }
  nav.tabs button .badge {
    background: var(--accent); color: #fff; border-radius: 999px;
    font-size: 10px; padding: 1px 6px; margin-left: 4px; font-weight: 700;
  }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
  .card {
    background: var(--white); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 18px 18px 16px; box-shadow: var(--shadow-sm);
    transition: transform 0.2s, box-shadow 0.2s; position: relative; overflow: hidden;
  }
  .card::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
    background: var(--card-accent, var(--brand)); opacity: 0.85;
  }
  .card:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
  .card .icon { font-size: 18px; margin-bottom: 10px; opacity: 0.85; }
  .card .label {
    font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--muted); font-weight: 600;
  }
  .card .value {
    font-family: var(--serif); font-size: 2.1rem; font-weight: 400;
    margin-top: 4px; color: var(--brand); letter-spacing: -0.02em; line-height: 1.1;
  }
  .card .hint { color: var(--muted); font-size: 12px; margin-top: 6px; font-weight: 400; }

  h2 {
    font-family: var(--serif); font-size: 1.5rem; font-weight: 400;
    margin: 28px 0 14px; letter-spacing: -0.01em;
  }
  .section-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    margin: 28px 0 14px;
  }
  .section-head h2 { margin: 0; }
  .section-head .total {
    font-family: var(--serif); font-size: 1.35rem; color: var(--accent);
  }
  .panel {
    background: var(--white); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 22px 24px; box-shadow: var(--shadow-sm);
  }
  table {
    width: 100%; border-collapse: separate; border-spacing: 0;
    background: var(--white); border: 1px solid var(--line);
    border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-sm);
  }
  th, td { text-align: left; padding: 13px 16px; border-bottom: 1px solid var(--line); font-size: 14px; }
  th {
    background: var(--paper); color: var(--ink-soft); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600;
    position: sticky; top: 0;
  }
  tr:last-child td { border-bottom: none; }
  tbody tr { transition: background 0.15s; }
  tbody tr:hover td { background: rgba(26,46,40,0.02); }
  .money { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--brand); }
  .zone-tag {
    display: inline-block; font-size: 11px; font-weight: 600; padding: 3px 8px;
    border-radius: 6px; background: var(--paper-2); color: var(--ink-soft);
  }

  .review-item {
    background: var(--white); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 18px 20px; margin-bottom: 12px; box-shadow: var(--shadow-sm);
  }
  .review-item pre {
    white-space: pre-wrap; font-family: inherit; margin: 10px 0 14px;
    background: var(--paper); border-radius: 10px; padding: 12px 14px; font-size: 14px;
  }
  .review-item .meta { color: var(--muted); font-size: 12px; }
  .review-item .reason {
    background: #faf6f0; border: 1px solid rgba(184,149,106,0.2);
    border-radius: 10px; padding: 10px 14px; margin: 10px 0; font-size: 13px;
  }

  button.action, a.action {
    font-family: var(--sans); font-size: 13px; font-weight: 600;
    padding: 12px 20px; border-radius: 12px; border: none; cursor: pointer;
    background: var(--brand); color: #f4faf7; text-decoration: none;
    display: inline-flex; align-items: center; gap: 8px;
    box-shadow: 0 8px 24px rgba(26,46,40,0.18); transition: transform 0.15s, box-shadow 0.15s;
  }
  button.action:hover, a.action:hover { transform: translateY(-1px); box-shadow: 0 12px 32px rgba(26,46,40,0.22); }
  button.action.secondary, a.action.secondary {
    background: var(--white); color: var(--ink); border: 1px solid var(--line); box-shadow: none;
  }
  button.action.accent {
    background: linear-gradient(135deg, var(--accent-2), var(--accent));
    box-shadow: 0 8px 24px rgba(196,92,106,0.25);
  }
  .toolbar { display: flex; gap: 10px; align-items: center; margin: 20px 0; flex-wrap: wrap; }
  input[type="date"], input[type="text"] {
    font-family: var(--sans); font-size: 14px; padding: 11px 14px;
    border: 1px solid var(--line); border-radius: 12px; background: var(--white);
  }

  #chat-log { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; min-height: 300px; }
  .bubble {
    max-width: 78%; padding: 14px 18px; border-radius: 16px; white-space: pre-wrap;
    font-size: 14px; line-height: 1.5; animation: fadeUp 0.3s ease both;
  }
  .bubble.you { align-self: flex-end; background: var(--brand); color: #f4faf7; border-bottom-right-radius: 4px; }
  .bubble.bot {
    align-self: flex-start; background: var(--white); border: 1px solid var(--line);
    border-bottom-left-radius: 4px; box-shadow: var(--shadow-sm);
  }
  .bubble.thinking { color: var(--muted); font-style: italic; background: transparent; border: none; box-shadow: none; }
  .mode-chip { display: block; font-size: 10px; color: var(--muted); margin-top: 8px; letter-spacing: 0.06em; text-transform: uppercase; }
  .prompt-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .prompt-chips button {
    font-family: var(--sans); font-size: 12px; padding: 8px 14px; border-radius: 999px;
    border: 1px solid var(--line); background: var(--white); color: var(--ink-soft);
    cursor: pointer; transition: all 0.15s;
  }
  .prompt-chips button:hover { border-color: var(--accent); color: var(--accent); background: rgba(196,92,106,0.04); }

  #toast {
    display: none; position: fixed; bottom: 88px; left: 50%; transform: translateX(-50%);
    background: var(--brand); color: #fff; padding: 12px 20px; border-radius: 12px; z-index: 50;
    box-shadow: var(--shadow-lg); font-size: 13px; font-weight: 500;
  }
  #chat-form {
    display: flex; gap: 10px; position: fixed; bottom: 0; left: 0; right: 0; z-index: 30;
    background: rgba(244,247,245,0.92); backdrop-filter: blur(16px);
    border-top: 1px solid var(--line); padding: 14px 28px;
  }
  #chat-form input { flex: 1; }
  .empty { color: var(--muted); padding: 32px; text-align: center; font-weight: 400; }
  .hidden { display: none !important; }

  .settings-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 20px; }
  @media (max-width: 860px) { .settings-grid { grid-template-columns: 1fr; } nav.tabs { flex-wrap: wrap; } nav.tabs button { flex: unset; } }
  .settings-block + .settings-block { margin-top: 16px; }
  .settings-block h3 { font-family: var(--serif); font-size: 1.2rem; font-weight: 400; margin: 0 0 10px; }
  .settings-block p, .settings-block li { color: var(--ink-soft); font-size: 14px; margin: 0 0 8px; }
  .settings-block ul { margin: 0; padding-left: 1.1rem; }
  .settings-block code, .callout code {
    font-family: ui-monospace, monospace; font-size: 12px;
    background: var(--paper-2); padding: 2px 6px; border-radius: 5px;
  }
  .callout {
    border-left: 3px solid var(--accent); background: rgba(196,92,106,0.06);
    padding: 12px 14px; border-radius: 0 12px 12px 0; margin: 12px 0; font-size: 13px;
  }
  .callout.gold { border-color: var(--gold); background: rgba(184,149,106,0.08); }
  .qr-panel { text-align: center; }
  .qr-frame {
    margin: 14px auto; min-height: 240px; max-width: 260px;
    display: grid; place-items: center; background: var(--paper);
    border: 1px solid var(--line); border-radius: 16px; padding: 14px;
  }
  .qr-frame img { width: 220px; height: 220px; border-radius: 8px; }
  .qr-status { font-size: 12px; color: var(--muted); margin-top: 8px; }
  .steps { counter-reset: step; list-style: none; padding: 0; margin: 16px 0 0; text-align: left; }
  .steps li {
    counter-increment: step; position: relative; padding: 10px 0 10px 36px;
    border-bottom: 1px solid var(--line); color: var(--ink-soft); font-size: 13px;
  }
  .steps li:last-child { border-bottom: none; }
  .steps li::before {
    content: counter(step); position: absolute; left: 0; top: 10px;
    width: 24px; height: 24px; border-radius: 50%; background: var(--brand); color: #fff;
    font-size: 11px; font-weight: 600; display: grid; place-items: center;
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
</head>
<body>
<div id="status-banner"></div>

<div class="topbar">
  <div class="topbar-brand">
    <div class="topbar-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><path d="M12 3c1.8 2.8 2.2 5.2 1.2 7.1C15.4 9.4 18 9.8 20 12c-2.6.4-4.8-.2-6.4-1.5.6 2.2.2 4.6-1.6 7.5-1.8-2.9-2.2-5.3-1.6-7.5C8.8 11.8 6.6 12.4 4 12c2-2.2 4.6-2.6 6.8-1.9C9.8 8.2 10.2 5.8 12 3z" fill="#f3d9c4"/><circle cx="12" cy="11.5" r="1.6" fill="#c45c6a"/></svg>
    </div>
    <span class="topbar-title">Bring My Flowers</span>
  </div>
  <div class="topbar-pills">
    <span class="pill" id="pill-wa"><span class="dot"></span> WhatsApp</span>
    <span class="pill ai" id="pill-ai">AI</span>
    <span class="pill" id="today-label"></span>
  </div>
</div>

<div class="shell">
  <div class="hero-grid">
    <div class="hero-copy">
      <div class="eyebrow">Owner console · Gurgaon</div>
      <h1>Your shop,<br>one quiet dashboard.</h1>
      <p class="lead">Deliveries, collections, review queue, and tomorrow's sheet — without WhatsApp noise. Staff call the bot when they need it.</p>
      <div class="hero-stats" id="hero-stats">
        <div class="hero-stat"><div class="num" id="stat-customers">—</div><div class="lbl">Customers</div></div>
        <div class="hero-stat"><div class="num" id="stat-subs">—</div><div class="lbl">Active subs</div></div>
        <div class="hero-stat"><div class="num" id="stat-review">—</div><div class="lbl">Needs review</div></div>
      </div>
    </div>
    <div class="pulse-card" id="pulse-card">
      <div class="label">Tomorrow's operations</div>
      <div class="big" id="pulse-count">—</div>
      <div class="sub" id="pulse-date">Loading…</div>
      <div class="pulse-metrics">
        <div class="pulse-metric"><div class="v" id="pulse-revenue">—</div><div class="l">Revenue</div></div>
        <div class="pulse-metric"><div class="v" id="pulse-collect">—</div><div class="l">To collect</div></div>
      </div>
      <div class="zone-bars" id="pulse-zones"></div>
    </div>
  </div>

  <nav class="tabs">
    <button data-tab="home" class="active">Overview</button>
    <button data-tab="deliveries">Deliveries</button>
    <button data-tab="money">Money</button>
    <button data-tab="review">Review <span class="badge hidden" id="review-badge"></span></button>
    <button data-tab="chat">Ask the bot</button>
    <button data-tab="settings">Settings</button>
  </nav>

  <main>
    <section id="tab-home">
      <div class="cards" id="overview-cards"><div class="empty">Loading…</div></div>
      <div class="toolbar">
        <button class="action accent" id="download-sheet">Download tomorrow's sheet</button>
        <a class="action secondary" href="/architecture" target="_blank">System architecture</a>
      </div>
    </section>

    <section id="tab-deliveries" class="hidden">
      <div class="toolbar">
        <label for="deliveries-date">Date</label>
        <input type="date" id="deliveries-date">
        <button class="action secondary" id="deliveries-refresh">Refresh</button>
        <button class="action" id="deliveries-sheet">Export sheet</button>
      </div>
      <div id="deliveries-table"></div>
    </section>

    <section id="tab-money" class="hidden">
      <div class="section-head">
        <h2>Pending payments</h2>
        <span class="total" id="collections-total"></span>
      </div>
      <div id="collections-table"></div>
      <h2>Renewals to chase</h2>
      <div id="renewals-table"></div>
    </section>

    <section id="tab-review" class="hidden">
      <p style="color:var(--muted);margin-top:0;font-size:14px">Messages the bot refused to auto-apply. Handle in Updates or Master, then mark done.</p>
      <div id="review-list"></div>
    </section>

    <section id="tab-chat" class="hidden">
      <div class="prompt-chips">
        <button type="button" data-q="How many deliveries tomorrow?">Deliveries tomorrow</button>
        <button type="button" data-q="Who owes the most?">Top debtors</button>
        <button type="button" data-q="Pending payments summary">Collections</button>
        <button type="button" data-q="What needs review?">Review queue</button>
      </div>
      <div id="chat-log">
        <div class="bubble bot">Ask about deliveries, payments, customers, or stock. Same read-only intelligence as group Q&amp;A.</div>
      </div>
    </section>

    <section id="tab-settings" class="hidden">
      <div class="settings-grid">
        <div>
          <div class="panel settings-block">
            <h3>How the WhatsApp bot works</h3>
            <p>Listens only in the <strong>Updates</strong> group. Personal chats ignored.</p>
            <ul>
              <li>Staff posts are <strong>staged</strong> and applied overnight — no reply needed.</li>
              <li>Call the bot: <code>Bot,</code> / <code>Flower Bot,</code> / <code>BMF,</code> + question.</li>
              <li>Sheet in WhatsApp: <code>Bot, send sheet</code> only.</li>
            </ul>
            <div class="callout">Nightly run posts the sheet to the Updates group and saves a copy here. Personal owner DMs stay off (OWNER_SHEET_DM=0).</div>
          </div>
          <div class="panel settings-block">
            <h3>Owner AI (read-only)</h3>
            <p>Claude/OpenAI with database tools that cannot change orders or payments. Key stays in local <code>.env</code>.</p>
          </div>
        </div>
        <div>
          <div class="panel qr-panel settings-block">
            <h3>Link or replace WhatsApp</h3>
            <div class="qr-frame" id="settings-qr"><p class="empty" style="padding:12px">Checking…</p></div>
            <div class="qr-status" id="settings-qr-status">Starting…</div>
            <div class="toolbar" style="justify-content:center">
              <a class="action secondary" href="/link">Full link page</a>
              <button class="action" type="button" id="refresh-qr">Refresh QR</button>
            </div>
            <ol class="steps">
              <li>Only one bot window should run.</li>
              <li>Replacing a number: log out linked device on old phone.</li>
              <li>New phone: Linked Devices → scan QR.</li>
            </ol>
          </div>
        </div>
      </div>
    </section>
  </main>
</div>

<div id="toast"></div>
<form id="chat-form" class="hidden">
  <input type="text" id="chat-input" placeholder="Ask about the business…" autocomplete="off">
  <button class="action" type="submit">Send</button>
</form>

<script>
const rupees = n => '₹' + Math.round(n).toLocaleString('en-IN');
const el = id => document.getElementById(id);
let qrTimer = null;

function toast(msg) {
  const node = el('toast');
  node.textContent = msg;
  node.style.display = 'block';
  setTimeout(() => { node.style.display = 'none'; }, 4000);
}

function switchTab(name) {
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  for (const tab of ['home', 'deliveries', 'money', 'review', 'chat', 'settings']) {
    el('tab-' + tab).classList.toggle('hidden', tab !== name);
  }
  el('chat-form').classList.toggle('hidden', name !== 'chat');
  if (qrTimer) { clearInterval(qrTimer); qrTimer = null; }
  if (name === 'home') loadOverview();
  if (name === 'deliveries') loadDeliveries();
  if (name === 'money') { loadCollections(); loadRenewals(); }
  if (name === 'review') loadReview();
  if (name === 'settings') { refreshQr(); qrTimer = setInterval(refreshQr, 3000); }
}
document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

document.querySelectorAll('.prompt-chips button').forEach(btn => {
  btn.onclick = () => { el('chat-input').value = btn.dataset.q; el('chat-form').requestSubmit(); };
});

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let detail = 'Request failed';
    try { const body = await response.json(); detail = body.error || detail; } catch {}
    throw new Error(detail);
  }
  return response.json();
}

function table(headers, rows) {
  if (rows.length === 0) return '<div class="empty">Nothing here</div>';
  return '<table><thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}

function zoneBars(byZone, dark) {
  const entries = Object.entries(byZone || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return dark ? '<div class="title">No zone data</div>' : '<span class="hint">No zones</span>';
  const max = Math.max(...entries.map(e => e[1]), 1);
  if (!dark) return entries.map(([k, v]) => k + ': ' + v).join(' · ');
  return '<div class="title">By zone</div>' + entries.map(([k, v]) =>
    '<div class="zone-row"><span class="name">' + k + '</span><div class="bar-wrap"><div class="bar" style="width:' + Math.round(v / max * 100) + '%"></div></div><span class="count">' + v + '</span></div>'
  ).join('');
}

function applyHealth(health) {
  const banner = el('status-banner');
  const waPill = el('pill-wa');
  const aiPill = el('pill-ai');
  if (health) {
    if (health.whatsappConnected && health.linked && health.updatesGroupConfigured) {
      waPill.className = 'pill ok'; waPill.innerHTML = '<span class="dot"></span> WhatsApp online';
    } else {
      waPill.className = 'pill warn'; waPill.innerHTML = '<span class="dot"></span> WhatsApp offline';
    }
  }
  if (!health) { banner.style.display = 'none'; return; }
  if (health.whatsappConnected && health.linked && health.updatesGroupConfigured) {
    banner.className = 'ok'; banner.style.display = 'block';
    banner.textContent = 'All systems online · Sheets on dashboard + Updates group nightly · No personal DMs';
    return;
  }
  banner.className = ''; banner.style.display = 'block';
  const parts = [];
  if (!health.linked) parts.push('WhatsApp not linked — open Settings');
  else if (!health.whatsappConnected) parts.push('WhatsApp reconnecting…');
  if (!health.updatesGroupConfigured) parts.push('UPDATES_GROUP_JID missing');
  banner.innerHTML = parts.join(' · ');
}

function renderPulse(data) {
  el('pulse-count').textContent = data.tomorrow.count;
  el('pulse-date').textContent = data.tomorrow.date + ' · ' + data.tomorrow.count + ' deliveries scheduled';
  el('pulse-revenue').textContent = rupees(data.tomorrow.revenue);
  el('pulse-collect').textContent = rupees(data.tomorrow.collect);
  el('pulse-zones').innerHTML = zoneBars(data.tomorrow.byZone, true);
  el('stat-customers').textContent = (data.customerCount ?? '—').toLocaleString('en-IN');
  el('stat-subs').textContent = (data.activeSubscriptions ?? '—').toLocaleString('en-IN');
  el('stat-review').textContent = data.reviewCount;
}

async function refreshQr() {
  const frame = el('settings-qr');
  const status = el('settings-qr-status');
  try {
    const health = await getJson('/api/health');
    applyHealth(health);
    if (health.whatsappConnected && health.linked) {
      status.textContent = 'Connected';
      frame.innerHTML = '<p class="empty" style="padding:16px;font-size:13px">Linked.<br>Log out on phone to swap numbers.</p>';
      return;
    }
    status.textContent = health.linked ? 'Reconnecting…' : 'Scan with WhatsApp → Linked Devices';
    const qrRes = await fetch('/api/qr');
    if (qrRes.ok) {
      const data = await qrRes.json();
      frame.innerHTML = '<img alt="WhatsApp QR" src="' + data.qr + '">';
    } else {
      frame.innerHTML = '<p class="empty" style="padding:16px;font-size:13px">No QR yet — wait and Refresh.</p>';
    }
  } catch {
    status.textContent = 'Bot not reachable';
    frame.innerHTML = '<p class="empty">Waiting…</p>';
  }
}
el('refresh-qr').onclick = refreshQr;

async function loadOverview() {
  try {
    const data = await getJson('/api/overview');
    el('today-label').textContent = data.today.date;
    el('pill-ai').textContent = (data.qaMode || 'AI')
      .replace('Cloud AI (', '').replace(') with read-only tools', '').replace('anthropic', 'Claude');
    applyHealth(data.health);
    renderPulse(data);
    const accents = ['var(--brand)', 'var(--accent)', 'var(--gold)', 'var(--ok)', 'var(--accent-2)', 'var(--ink-soft)'];
    const icons = ['◆', '◇', '₹', '↻', '⚑', '◷'];
    const items = [
      ['Deliveries today', data.today.count, zoneBars(data.today.byZone, false), icons[0]],
      ['Deliveries tomorrow', data.tomorrow.count, rupees(data.tomorrow.revenue) + ' revenue', icons[1]],
      ['Pending collections', rupees(data.pendingCollections), 'across active subs', icons[2]],
      ['Renewals due', data.renewalsDue, 'cycles to chase', icons[3]],
      ['Needs review', data.reviewCount, 'unclear group messages', icons[4]],
      ['Staged updates', data.stagedUpdates, 'awaiting nightly run', icons[5]]
    ];
    el('overview-cards').innerHTML = items.map((item, i) =>
      '<div class="card" style="--card-accent:' + accents[i % accents.length] + '">' +
        '<div class="icon">' + item[3] + '</div>' +
        '<div class="label">' + item[0] + '</div>' +
        '<div class="value">' + item[1] + '</div>' +
        '<div class="hint">' + item[2] + '</div></div>'
    ).join('');
    const badge = el('review-badge');
    badge.textContent = data.reviewCount;
    badge.classList.toggle('hidden', data.reviewCount === 0);
  } catch { el('overview-cards').innerHTML = '<div class="empty">Could not load — is the bot running?</div>'; }
}

async function loadDeliveries() {
  try {
    const date = el('deliveries-date').value;
    const data = await getJson('/api/deliveries' + (date ? '?date=' + date : ''));
    if (!el('deliveries-date').value) el('deliveries-date').value = data.date;
    el('deliveries-table').innerHTML = table(
      ['ID', 'Customer', 'Zone', 'Time', 'Package', 'Revenue', 'Collect'],
      data.deliveries.map(d => [d.id, d.name, '<span class="zone-tag">' + d.zone + '</span>',
        d.timeSlot || '—', d.package,
        '<span class="money">' + rupees(d.revenue) + '</span>',
        d.collect ? '<span class="money">' + rupees(d.collect) + '</span>' : '—'])
    );
  } catch (e) { el('deliveries-table').innerHTML = '<div class="empty">' + (e.message || 'Failed to load') + '</div>'; }
}
el('deliveries-refresh').onclick = loadDeliveries;

async function downloadSheet(date) {
  try {
    const url = '/api/sheet' + (date ? '?date=' + encodeURIComponent(date) : '');
    const response = await fetch(url);
    if (!response.ok) {
      let msg = 'Sheet download failed';
      try { msg = (await response.json()).error || msg; } catch {}
      toast(msg); return;
    }
    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'del-sheet-' + (date || 'tomorrow') + '.xlsx';
    a.click();
    toast('Sheet downloaded');
  } catch (e) { toast(e.message || 'Download failed'); }
}
el('deliveries-sheet').onclick = () => downloadSheet(el('deliveries-date').value);
el('download-sheet').onclick = () => downloadSheet('');

async function loadCollections() {
  const data = await getJson('/api/collections');
  el('collections-total').textContent = data.total ? rupees(data.total) + ' outstanding' : '';
  el('collections-table').innerHTML = table(
    ['Customer', 'Zone', 'Phone', 'Owes'],
    data.debtors.map(d => ['#' + d.id + ' ' + d.name, d.zone, d.phones,
      '<span class="money">' + rupees(d.owed) + '</span>'])
  );
}

async function loadRenewals() {
  const data = await getJson('/api/renewals');
  el('renewals-table').innerHTML = table(
    ['Customer', 'Package', 'Amount', 'Last delivery', 'Days ago'],
    data.renewals.map(r => ['#' + r.customerId + ' ' + r.name, r.packageName,
      '<span class="money">' + rupees(r.packAmount) + '</span>', r.lastDelivery, r.daysSince])
  );
}

async function loadReview() {
  const data = await getJson('/api/review');
  if (data.items.length === 0) {
    el('review-list').innerHTML = '<div class="empty">All clear</div>';
    return;
  }
  el('review-list').innerHTML = data.items.map(item =>
    '<div class="review-item" id="review-' + item.id + '">' +
      '<div class="meta">' + item.participant + ' · ' + (item.received_at || item.created_at) + ' · ' + (item.classification || '') + '</div>' +
      '<div class="reason"><strong>Why:</strong> ' + (item.escalation_reason || 'Needs review').replace(/</g, '&lt;') +
        '<br><strong>Action:</strong> ' + (item.suggestedAction || '').replace(/</g, '&lt;') + '</div>' +
      '<pre>' + item.message_text.replace(/</g, '&lt;') + '</pre>' +
      '<button class="action" data-review-id="' + item.id + '">Mark handled</button></div>'
  ).join('');
  el('review-list').querySelectorAll('[data-review-id]').forEach(btn => {
    btn.onclick = () => resolveReview(Number(btn.dataset.reviewId));
  });
}
async function resolveReview(id) {
  await getJson('/api/review/' + id + '/resolve', { method: 'POST' });
  const node = el('review-' + id);
  if (node) node.remove();
  loadOverview();
  if (!document.querySelector('.review-item')) loadReview();
}

el('chat-form').onsubmit = async event => {
  event.preventDefault();
  const input = el('chat-input');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';
  const log = el('chat-log');
  log.insertAdjacentHTML('beforeend', '<div class="bubble you">' + question.replace(/</g, '&lt;') + '</div>');
  log.insertAdjacentHTML('beforeend', '<div class="bubble bot thinking" id="thinking">Thinking…</div>');
  window.scrollTo(0, document.body.scrollHeight);
  try {
    const data = await getJson('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    el('thinking').outerHTML = '<div class="bubble bot">' + data.answer.replace(/</g, '&lt;') +
      '<div class="mode-chip">' + (data.mode || 'bot') + '</div></div>';
  } catch (e) {
    el('thinking').outerHTML = '<div class="bubble bot">' + (e.message || 'Error') + '</div>';
  }
  window.scrollTo(0, document.body.scrollHeight);
};

loadOverview();
setInterval(loadOverview, 30000);
</script>
</body>
</html>`;

export const LINK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f1714">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<title>Link WhatsApp — Bring My Flowers</title>
<style>
  :root { --brand:#0f1714; --accent:#c45c6a; --muted:#7a8f86; --serif:"Instrument Serif", Georgia, serif; --sans:"DM Sans", system-ui, sans-serif; }
  body {
    margin: 0; min-height: 100vh; font-family: var(--sans); color: var(--brand);
    display: flex; align-items: center; justify-content: center; padding: 24px;
    background: radial-gradient(ellipse at 20% 0%, rgba(196,92,106,0.1), transparent 50%), #f4f7f5;
  }
  .box {
    background: #fff; border: 1px solid rgba(15,23,20,0.08); border-radius: 22px;
    padding: 36px 32px; max-width: 420px; text-align: center; box-shadow: 0 32px 80px rgba(15,23,20,0.1);
  }
  h1 { font-family: var(--serif); font-size: 2rem; font-weight: 400; margin: 0 0 8px; }
  p { color: var(--muted); margin: 0 0 8px; font-size: 14px; }
  #qr { margin: 20px auto; min-height: 260px; display: grid; place-items: center; }
  #qr img { width: 240px; height: 240px; border-radius: 12px; background: #f4f7f5; padding: 8px; }
  .status { font-weight: 600; margin-top: 12px; font-size: 14px; }
  a.btn {
    display: inline-block; margin-top: 20px; background: var(--brand); color: #f4faf7;
    text-decoration: none; padding: 12px 20px; border-radius: 12px; font-weight: 600; font-size: 14px;
  }
</style>
</head>
<body>
  <div class="box">
    <h1>Link WhatsApp</h1>
    <p>WhatsApp → Linked Devices → Link a Device → scan below.</p>
    <div id="qr"><p>Waiting for QR…</p></div>
    <div class="status" id="status">Starting…</div>
    <a class="btn" href="/">Open owner console</a>
  </div>
<script>
async function refresh() {
  try {
    const health = await fetch('/api/health').then(r => r.json());
    const status = document.getElementById('status');
    if (health.whatsappConnected && health.linked) {
      status.textContent = 'Connected';
      document.getElementById('qr').innerHTML = '<p>WhatsApp is linked.</p>';
      return;
    }
    status.textContent = health.linked ? 'Reconnecting…' : 'Scan the QR';
    const qrRes = await fetch('/api/qr');
    if (qrRes.ok) {
      document.getElementById('qr').innerHTML = '<img alt="QR" src="' + (await qrRes.json()).qr + '">';
    } else {
      document.getElementById('qr').innerHTML = '<p>No QR yet — wait a few seconds.</p>';
    }
  } catch { document.getElementById('status').textContent = 'Bot not reachable'; }
}
refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;

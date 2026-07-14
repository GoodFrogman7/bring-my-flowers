/**
 * Owner dashboard + WhatsApp link pages, inlined so business mode ships zero
 * static assets. Premium ops console for a non-technical flower-business owner.
 */
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1a2e28">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<title>Bring My Flowers — Owner Console</title>
<style>
  :root {
    --ink: #14201c;
    --ink-soft: #3d4f48;
    --muted: #6b7c74;
    --paper: #f3f6f4;
    --paper-2: #e8eee9;
    --panel: rgba(255, 255, 255, 0.82);
    --panel-solid: #ffffff;
    --line: rgba(26, 46, 40, 0.1);
    --brand: #1a2e28;
    --accent: #c45c6a;
    --accent-soft: #f8e9eb;
    --gold: #b8956c;
    --ok: #1f6b4a;
    --ok-bg: #e8f5ef;
    --warn: #9b2c2c;
    --warn-bg: #fdecec;
    --radius: 16px;
    --shadow: 0 18px 50px rgba(20, 32, 28, 0.08);
    --serif: "Cormorant Garamond", Georgia, serif;
    --sans: "Outfit", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    color: var(--ink);
    font-family: var(--sans);
    font-size: 16px;
    line-height: 1.55;
    background:
      radial-gradient(1200px 600px at 8% -10%, rgba(196, 92, 106, 0.12), transparent 55%),
      radial-gradient(900px 500px at 100% 0%, rgba(184, 149, 108, 0.14), transparent 50%),
      linear-gradient(165deg, #eef3f0 0%, #f7f5f2 42%, #e9efeb 100%);
  }
  body::before {
    content: "";
    position: fixed; inset: 0; pointer-events: none; opacity: 0.35;
    background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%231a2e28' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
  }
  #status-banner {
    display: none; position: relative; z-index: 2;
    padding: 12px 28px; font-weight: 500; font-size: 14px;
    background: var(--warn-bg); color: var(--warn); border-bottom: 1px solid rgba(155, 44, 44, 0.15);
  }
  #status-banner.ok {
    background: var(--ok-bg); color: var(--ok); border-color: rgba(31, 107, 74, 0.15);
  }
  #status-banner a { color: inherit; font-weight: 600; }
  .shell { position: relative; z-index: 1; max-width: 1120px; margin: 0 auto; padding: 28px 22px 110px; }
  header.hero {
    display: grid; gap: 8px; margin-bottom: 28px;
    animation: rise 0.7s ease both;
  }
  .brand-mark {
    display: inline-flex; align-items: center; gap: 14px;
  }
  .mark {
    width: 48px; height: 48px; border-radius: 14px;
    background: linear-gradient(145deg, #1a2e28, #2d4a40);
    box-shadow: 0 10px 24px rgba(26, 46, 40, 0.28);
    display: grid; place-items: center;
  }
  .mark svg { width: 26px; height: 26px; }
  .brand-text h1 {
    font-family: var(--serif); font-weight: 600; font-size: clamp(1.85rem, 3.5vw, 2.45rem);
    margin: 0; letter-spacing: -0.02em; color: var(--brand); line-height: 1.1;
  }
  .brand-text .tag {
    font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--gold); font-weight: 600; margin-top: 2px;
  }
  .hero-sub {
    color: var(--muted); font-weight: 300; font-size: 15px; max-width: 42ch; margin: 4px 0 0;
  }
  #today-label { color: var(--ink-soft); font-size: 13px; font-weight: 500; }
  nav.tabs {
    display: flex; gap: 4px; flex-wrap: wrap; padding: 6px;
    background: rgba(255,255,255,0.55); backdrop-filter: blur(12px);
    border: 1px solid var(--line); border-radius: 999px;
    box-shadow: var(--shadow); margin-bottom: 26px;
    animation: rise 0.75s ease 0.05s both;
  }
  nav.tabs button {
    appearance: none; border: 0; background: transparent; cursor: pointer;
    font-family: var(--sans); font-size: 14px; font-weight: 500;
    color: var(--ink-soft); padding: 11px 16px; border-radius: 999px;
    transition: background 0.2s, color 0.2s, transform 0.15s;
  }
  nav.tabs button:hover { color: var(--ink); background: rgba(26,46,40,0.05); }
  nav.tabs button.active {
    background: var(--brand); color: #f7faf8; box-shadow: 0 8px 20px rgba(26,46,40,0.25);
  }
  nav.tabs button .badge {
    background: var(--accent); color: #fff; border-radius: 999px;
    font-size: 11px; padding: 2px 7px; margin-left: 6px; font-weight: 600;
  }
  .cards {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;
    animation: rise 0.8s ease 0.08s both;
  }
  .card {
    background: var(--panel); backdrop-filter: blur(10px);
    border: 1px solid var(--line); border-radius: var(--radius);
    padding: 18px 18px 16px; box-shadow: var(--shadow);
    transition: transform 0.2s ease, border-color 0.2s;
  }
  .card:hover { transform: translateY(-2px); border-color: rgba(196,92,106,0.25); }
  .card .label {
    font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--muted); font-weight: 600;
  }
  .card .value {
    font-family: var(--serif); font-size: 2rem; font-weight: 600;
    margin-top: 6px; color: var(--brand); letter-spacing: -0.02em;
  }
  .card .hint { color: var(--muted); font-size: 13px; margin-top: 4px; font-weight: 300; }
  h2 {
    font-family: var(--serif); font-size: 1.55rem; font-weight: 600;
    margin: 28px 0 12px; color: var(--brand); letter-spacing: -0.01em;
  }
  .panel {
    background: var(--panel); backdrop-filter: blur(10px);
    border: 1px solid var(--line); border-radius: var(--radius);
    padding: 20px 22px; box-shadow: var(--shadow);
  }
  table {
    width: 100%; border-collapse: collapse; background: var(--panel-solid);
    border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden;
    box-shadow: var(--shadow);
  }
  th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--line); font-size: 14px; }
  th {
    background: var(--brand); color: #eef5f1; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;
  }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(26,46,40,0.02); }
  .money { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--brand); }
  .review-item {
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 16px 18px; margin-bottom: 12px; box-shadow: var(--shadow);
  }
  .review-item pre {
    white-space: pre-wrap; font-family: inherit; margin: 8px 0 12px;
    background: var(--paper-2); border-radius: 10px; padding: 12px; font-size: 14px;
  }
  .review-item .meta { color: var(--muted); font-size: 12px; letter-spacing: 0.02em; }
  .review-item .reason {
    background: #fff8f0; border: 1px solid rgba(184,149,108,0.25);
    border-radius: 10px; padding: 10px 12px; margin: 10px 0; font-size: 14px;
  }
  button.action {
    font-family: var(--sans); font-size: 14px; font-weight: 600;
    padding: 12px 18px; border-radius: 12px; border: none;
    background: linear-gradient(145deg, #1f3a32, #152722); color: #f4faf7;
    cursor: pointer; box-shadow: 0 10px 22px rgba(26,46,40,0.22);
    transition: transform 0.15s, box-shadow 0.15s;
  }
  button.action:hover { transform: translateY(-1px); box-shadow: 0 14px 28px rgba(26,46,40,0.28); }
  button.action.secondary {
    background: var(--panel-solid); color: var(--ink); border: 1px solid var(--line);
    box-shadow: none;
  }
  button.action.accent {
    background: linear-gradient(145deg, #d06a76, #b84d5c); box-shadow: 0 10px 22px rgba(196,92,106,0.28);
  }
  .toolbar { display: flex; gap: 10px; align-items: center; margin: 16px 0; flex-wrap: wrap; }
  input[type="date"], input[type="text"] {
    font-family: var(--sans); font-size: 15px; padding: 11px 14px;
    border: 1px solid var(--line); border-radius: 12px; background: #fff; color: var(--ink);
  }
  #chat-log { display: flex; flex-direction: column; gap: 12px; margin-bottom: 14px; min-height: 280px; }
  .bubble {
    max-width: 82%; padding: 14px 16px; border-radius: 16px; white-space: pre-wrap;
    font-size: 15px; animation: rise 0.35s ease both;
  }
  .bubble.you {
    align-self: flex-end; background: var(--brand); color: #f4faf7;
    border-bottom-right-radius: 6px;
  }
  .bubble.bot {
    align-self: flex-start; background: var(--panel-solid); border: 1px solid var(--line);
    border-bottom-left-radius: 6px; box-shadow: var(--shadow);
  }
  .bubble.thinking { color: var(--muted); font-style: italic; }
  .mode-chip { display: block; font-size: 11px; color: var(--muted); margin-top: 8px; letter-spacing: 0.04em; }
  #toast {
    display: none; position: fixed; bottom: 88px; left: 50%; transform: translateX(-50%);
    background: var(--brand); color: #fff; padding: 12px 18px; border-radius: 12px; z-index: 30;
    box-shadow: var(--shadow); font-size: 14px;
  }
  #chat-form {
    display: flex; gap: 10px; position: fixed; bottom: 0; left: 0; right: 0; z-index: 20;
    background: rgba(255,255,255,0.9); backdrop-filter: blur(14px);
    border-top: 1px solid var(--line); padding: 14px 22px;
  }
  #chat-form input { flex: 1; }
  .empty { color: var(--muted); padding: 28px; text-align: center; font-weight: 300; }
  .hidden { display: none !important; }
  .settings-grid {
    display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 18px;
  }
  @media (max-width: 860px) {
    .settings-grid { grid-template-columns: 1fr; }
    nav.tabs { border-radius: 18px; }
  }
  .settings-block + .settings-block { margin-top: 18px; }
  .settings-block h3 {
    font-family: var(--serif); font-size: 1.25rem; margin: 0 0 8px; color: var(--brand);
  }
  .settings-block p, .settings-block li {
    color: var(--ink-soft); font-size: 14px; margin: 0 0 8px;
  }
  .settings-block ul { margin: 0; padding-left: 1.15rem; }
  .settings-block code, .callout code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; background: var(--paper-2); padding: 2px 6px; border-radius: 6px;
  }
  .callout {
    border-left: 3px solid var(--accent); background: var(--accent-soft);
    padding: 12px 14px; border-radius: 0 12px 12px 0; margin: 12px 0; font-size: 14px;
  }
  .callout.gold { border-color: var(--gold); background: #f7f1e8; }
  .qr-panel { text-align: center; }
  .qr-frame {
    margin: 14px auto; min-height: 260px; max-width: 280px;
    display: grid; place-items: center; background: #fff;
    border: 1px solid var(--line); border-radius: 18px; padding: 16px;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.6), var(--shadow);
  }
  .qr-frame img { width: 240px; height: 240px; border-radius: 8px; }
  .qr-status { font-size: 13px; color: var(--muted); margin-top: 8px; }
  .steps { counter-reset: step; list-style: none; padding: 0; margin: 0; }
  .steps li {
    counter-increment: step; position: relative; padding: 10px 0 10px 42px;
    border-bottom: 1px solid var(--line); color: var(--ink-soft); font-size: 14px;
  }
  .steps li:last-child { border-bottom: none; }
  .steps li::before {
    content: counter(step); position: absolute; left: 0; top: 10px;
    width: 26px; height: 26px; border-radius: 50%;
    background: var(--brand); color: #fff; font-size: 12px; font-weight: 600;
    display: grid; place-items: center;
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
</head>
<body>
<div id="status-banner"></div>
<div class="shell">
  <header class="hero">
    <div class="brand-mark">
      <div class="mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 3c1.8 2.8 2.2 5.2 1.2 7.1C15.4 9.4 18 9.8 20 12c-2.6.4-4.8-.2-6.4-1.5.6 2.2.2 4.6-1.6 7.5-1.8-2.9-2.2-5.3-1.6-7.5C8.8 11.8 6.6 12.4 4 12c2-2.2 4.6-2.6 6.8-1.9C9.8 8.2 10.2 5.8 12 3z" fill="#f3d9c4"/><circle cx="12" cy="11.5" r="1.6" fill="#c45c6a"/></svg>
      </div>
      <div class="brand-text">
        <div class="tag">Owner console</div>
        <h1>Bring My Flowers</h1>
      </div>
    </div>
    <p class="hero-sub">Deliveries, money, review, and the delivery sheet — in one place. Sheets stay here; WhatsApp stays quiet unless staff call the bot.</p>
    <div id="today-label"></div>
  </header>

  <nav class="tabs">
    <button data-tab="home" class="active">Home</button>
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
      </div>
    </section>

    <section id="tab-deliveries" class="hidden">
      <div class="toolbar">
        <label for="deliveries-date">Date</label>
        <input type="date" id="deliveries-date">
        <button class="action secondary" id="deliveries-refresh">Show</button>
        <button class="action" id="deliveries-sheet">Sheet for this date</button>
      </div>
      <div id="deliveries-table"></div>
    </section>

    <section id="tab-money" class="hidden">
      <h2>Pending payments</h2>
      <div id="collections-table"></div>
      <h2>Renewals to chase</h2>
      <div id="renewals-table"></div>
    </section>

    <section id="tab-review" class="hidden">
      <p style="color:var(--muted);margin-top:0">Messages the bot did not auto-apply. Read why, fix it in Updates or Master, then mark done.</p>
      <div id="review-list"></div>
    </section>

    <section id="tab-chat" class="hidden">
      <div id="chat-log">
        <div class="bubble bot">Ask about deliveries, payments, a customer, or stock. Same intelligence as group Q&amp;A (Anthropic when configured).</div>
      </div>
    </section>

    <section id="tab-settings" class="hidden">
      <div class="settings-grid">
        <div>
          <div class="panel settings-block">
            <h3>How the WhatsApp bot works</h3>
            <p>The bot listens only in the <strong>Updates</strong> group. It ignores personal chats.</p>
            <ul>
              <li>Staff posts (holds, resumes, new one-offs) are <strong>staged</strong> and applied overnight — no bot reply needed.</li>
              <li>To talk to the bot, start with <code>Bot,</code> / <code>Flower Bot,</code> / <code>BMF,</code> then your question.</li>
              <li>Examples: <code>Bot, how many deliveries tomorrow?</code> · <code>Bot, pending payments</code></li>
              <li>To get the Excel in the group: <code>Bot, send sheet</code> (only on request).</li>
            </ul>
            <div class="callout">Nightly run writes the sheet to this app. It does <strong>not</strong> auto-post the file (or summary) to WhatsApp unless you turn those flags back on in <code>.env</code>.</div>
          </div>

          <div class="panel settings-block">
            <h3>Where to find the sheet</h3>
            <ul>
              <li><strong>Home</strong> → Download tomorrow's sheet</li>
              <li><strong>Deliveries</strong> → pick a date → Sheet for this date</li>
              <li>Group: only when someone says <code>Bot, send sheet</code></li>
            </ul>
          </div>

          <div class="panel settings-block">
            <h3>Owner AI answers</h3>
            <p>Q&amp;A uses your Anthropic API key when <code>LLM_PROVIDER=anthropic</code> is set. The cloud model only gets <strong>read-only</strong> tools — it cannot change orders, holds, or payments.</p>
            <div class="callout gold">Keep the key in local <code>.env</code> only. Never commit it or paste it into the Updates group.</div>
          </div>

          <div class="panel settings-block">
            <h3>Review queue</h3>
            <p>Ambiguous or incomplete Updates land in <strong>Review</strong>. Clear them after you handle the real-world action so the team trusts the queue.</p>
          </div>
        </div>

        <div>
          <div class="panel qr-panel settings-block">
            <h3>Link or replace WhatsApp number</h3>
            <p>Scan with the business phone to add or replace the linked device for this bot.</p>
            <div class="qr-frame" id="settings-qr"><p class="empty" style="padding:12px">Checking WhatsApp…</p></div>
            <div class="qr-status" id="settings-qr-status">Starting…</div>
            <div class="toolbar" style="justify-content:center">
              <a class="action secondary" href="/link" style="text-decoration:none;display:inline-block">Open full link page</a>
              <button class="action" type="button" id="refresh-qr">Refresh QR</button>
            </div>
            <ol class="steps">
              <li>Stop duplicate bot windows (only one should run).</li>
              <li>If replacing a number: on the old phone, WhatsApp → Linked Devices → log out this device.</li>
              <li>On the new phone: Linked Devices → Link a device → scan the QR above.</li>
              <li>Wait until status shows Connected, then return to Home.</li>
            </ol>
            <div class="callout">If the QR never appears, the session may already be linked, or the bot is still starting. Use Refresh, or delete <code>sessions/</code> only when you intentionally want a fresh login.</div>
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
  if (name === 'settings') {
    refreshQr();
    qrTimer = setInterval(refreshQr, 3000);
  }
}
document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

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
  return '<table><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr>' +
    rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table>';
}

function applyHealth(health) {
  const banner = el('status-banner');
  if (!health) { banner.style.display = 'none'; return; }
  if (health.whatsappConnected && health.linked && health.updatesGroupConfigured) {
    banner.className = 'ok';
    banner.style.display = 'block';
    banner.textContent = 'WhatsApp online · Updates group connected · Sheets live on this console (WhatsApp quiet unless bot is called)';
    return;
  }
  banner.className = '';
  banner.style.display = 'block';
  const parts = [];
  if (!health.linked) parts.push('WhatsApp not linked — open Settings to scan QR');
  else if (!health.whatsappConnected) parts.push('WhatsApp offline' + (health.lastError ? ': ' + health.lastError : '') + ' — wait, or reopen the app');
  if (!health.updatesGroupConfigured) parts.push('UPDATES_GROUP_JID missing in .env');
  banner.innerHTML = parts.join(' · ');
}

async function refreshQr() {
  const frame = el('settings-qr');
  const status = el('settings-qr-status');
  try {
    const health = await getJson('/api/health');
    applyHealth(health);
    if (health.whatsappConnected && health.linked) {
      status.textContent = 'Connected — this number is linked.';
      frame.innerHTML = '<p class="empty" style="padding:18px">WhatsApp is linked.<br>To replace the number, log out this linked device on the phone, then restart the bot for a new QR.</p>';
      return;
    }
    status.textContent = health.lastError || (health.linked ? 'Reconnecting…' : 'Scan the QR with WhatsApp → Linked Devices');
    const qrRes = await fetch('/api/qr');
    if (qrRes.ok) {
      const data = await qrRes.json();
      frame.innerHTML = '<img alt="WhatsApp QR" src="' + data.qr + '">';
    } else {
      frame.innerHTML = '<p class="empty" style="padding:18px">No QR yet — wait a few seconds while the bot starts, then Refresh.</p>';
    }
  } catch {
    status.textContent = 'Bot not reachable — start Bring My Flowers and try again.';
    frame.innerHTML = '<p class="empty" style="padding:18px">Waiting for the bot…</p>';
  }
}
el('refresh-qr').onclick = refreshQr;

async function loadOverview() {
  try {
    const data = await getJson('/api/overview');
    el('today-label').textContent = data.today.date + '  ·  ' + (data.qaMode || '');
    applyHealth(data.health);
    const zones = z => Object.entries(z).map(([k, v]) => k + ': ' + v).join(', ') || 'none';
    el('overview-cards').innerHTML =
      card('Deliveries today', data.today.count, zones(data.today.byZone)) +
      card('Deliveries tomorrow', data.tomorrow.count, zones(data.tomorrow.byZone)) +
      card('Pending collections', rupees(data.pendingCollections), 'across active subscriptions') +
      card('Renewals due', data.renewalsDue, 'cycles finished, not renewed') +
      card('Needs your review', data.reviewCount, 'unclear group messages') +
      card('Staged updates', data.stagedUpdates, 'waiting for the nightly run');
    const badge = el('review-badge');
    badge.textContent = data.reviewCount;
    badge.classList.toggle('hidden', data.reviewCount === 0);
  } catch { el('overview-cards').innerHTML = '<div class="empty">Could not load — is the bot running?</div>'; }
}
function card(label, value, hint) {
  return '<div class="card"><div class="label">' + label + '</div><div class="value">' + value +
    '</div><div class="hint">' + hint + '</div></div>';
}

async function loadDeliveries() {
  const date = el('deliveries-date').value;
  const data = await getJson('/api/deliveries' + (date ? '?date=' + date : ''));
  if (!el('deliveries-date').value) el('deliveries-date').value = data.date;
  el('deliveries-table').innerHTML = table(
    ['ID', 'Name', 'Zone', 'Time', 'Package', 'Collect'],
    data.deliveries.map(d => [d.id, d.name, d.zone, d.timeSlot || '—', d.package,
      d.collect ? '<span class="money">' + rupees(d.collect) + '</span>' : '—'])
  );
}
el('deliveries-refresh').onclick = loadDeliveries;

async function downloadSheet(date) {
  try {
    const url = '/api/sheet' + (date ? '?date=' + encodeURIComponent(date) : '');
    const response = await fetch(url);
    if (!response.ok) {
      let msg = 'Sheet download failed';
      try { msg = (await response.json()).error || msg; } catch {}
      toast(msg);
      return;
    }
    const blob = await response.blob();
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = 'del-sheet-' + (date || 'tomorrow') + '.xlsx';
    a.click();
    URL.revokeObjectURL(href);
    toast('Sheet downloaded');
  } catch (e) {
    toast(e.message || 'Sheet download failed');
  }
}
el('deliveries-sheet').onclick = () => downloadSheet(el('deliveries-date').value);
el('download-sheet').onclick = () => downloadSheet('');

async function loadCollections() {
  const data = await getJson('/api/collections');
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
    el('review-list').innerHTML = '<div class="empty">All clear — nothing needs review</div>';
    return;
  }
  el('review-list').innerHTML = data.items.map(item =>
    '<div class="review-item" id="review-' + item.id + '">' +
      '<div class="meta">From ' + item.participant + ' · ' + (item.received_at || item.created_at) +
        ' · ' + (item.classification || '') + '</div>' +
      '<div class="reason"><strong>Why:</strong> ' + (item.escalation_reason || 'Needs review').replace(/</g, '&lt;') +
        '<br><strong>Do this:</strong> ' + (item.suggestedAction || '').replace(/</g, '&lt;') + '</div>' +
      '<pre>' + item.message_text.replace(/</g, '&lt;') + '</pre>' +
      '<button class="action" onclick="resolveReview(' + item.id + ')">Mark handled</button>' +
    '</div>'
  ).join('');
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    el('thinking').outerHTML = '<div class="bubble bot">' + data.answer.replace(/</g, '&lt;') +
      '<div class="mode-chip">Answered via ' + (data.mode || 'bot') + '</div></div>';
  } catch (e) {
    el('thinking').outerHTML = '<div class="bubble bot">' + (e.message || 'Something went wrong') + '</div>';
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
<meta name="theme-color" content="#1a2e28">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
<title>Link WhatsApp — Bring My Flowers</title>
<style>
  :root { --brand:#1a2e28; --accent:#c45c6a; --muted:#6b7c74; --serif:"Cormorant Garamond", Georgia, serif; --sans:"Outfit", system-ui, sans-serif; }
  body {
    margin: 0; min-height: 100vh; font-family: var(--sans); color: var(--brand);
    display: flex; align-items: center; justify-content: center; padding: 24px;
    background:
      radial-gradient(800px 400px at 10% 0%, rgba(196,92,106,0.14), transparent 55%),
      linear-gradient(165deg, #eef3f0, #f7f5f2);
  }
  .box {
    background: rgba(255,255,255,0.88); border: 1px solid rgba(26,46,40,0.1);
    border-radius: 22px; padding: 32px 28px; max-width: 440px; text-align: center;
    box-shadow: 0 24px 60px rgba(20,32,28,0.1);
  }
  h1 { font-family: var(--serif); font-size: 2rem; margin: 0 0 8px; font-weight: 600; }
  p { color: var(--muted); margin: 0 0 8px; font-size: 14px; }
  #qr { margin: 18px auto; min-height: 280px; display: grid; place-items: center; }
  #qr img { width: 260px; height: 260px; border-radius: 12px; background: #fff; padding: 10px; }
  .status { font-weight: 600; margin-top: 12px; font-size: 14px; }
  a.btn {
    display: inline-block; margin-top: 18px; background: var(--brand); color: #f4faf7;
    text-decoration: none; padding: 12px 18px; border-radius: 12px; font-weight: 600; font-size: 14px;
  }
</style>
</head>
<body>
  <div class="box">
    <h1>Link WhatsApp</h1>
    <p>On the business phone: WhatsApp → Linked Devices → Link a Device → scan this QR.</p>
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
      status.textContent = 'Connected — you can open the dashboard.';
      document.getElementById('qr').innerHTML = '<p>WhatsApp is linked.</p>';
      return;
    }
    status.textContent = health.lastError || (health.linked ? 'Reconnecting…' : 'Scan the QR below');
    const qrRes = await fetch('/api/qr');
    if (qrRes.ok) {
      const data = await qrRes.json();
      document.getElementById('qr').innerHTML = '<img alt="WhatsApp QR" src="' + data.qr + '">';
    } else {
      document.getElementById('qr').innerHTML = '<p>No QR yet — wait a few seconds while the bot starts.</p>';
    }
  } catch {
    document.getElementById('status').textContent = 'Bot not reachable yet — wait and retry.';
  }
}
refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;

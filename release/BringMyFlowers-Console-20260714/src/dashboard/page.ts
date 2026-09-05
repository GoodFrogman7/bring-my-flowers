/**
 * Owner dashboard + WhatsApp link pages, inlined so business mode ships zero
 * static assets. Designed for a non-technical owner.
 */
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#b83280">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<title>Bring My Flowers — Dashboard</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #ffffff; --ink: #1e2430; --muted: #667085;
    --brand: #b83280; --brand-soft: #fdf2f8; --ok: #087443; --warn: #b42318;
    --line: #e4e7ec; --radius: 14px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    font-size: 17px; line-height: 1.5;
  }
  header {
    background: var(--card); border-bottom: 1px solid var(--line);
    padding: 14px 20px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  }
  header h1 { font-size: 22px; margin: 0; }
  header .sub { color: var(--muted); font-size: 14px; }
  #status-banner {
    display: none; padding: 12px 20px; font-weight: 600; background: #fef3f2; color: var(--warn);
    border-bottom: 1px solid #fecdca;
  }
  #status-banner.ok { background: #ecfdf3; color: var(--ok); border-color: #abefc6; }
  #status-banner a { color: inherit; }
  nav { display: flex; gap: 8px; padding: 14px 20px 0; flex-wrap: wrap; }
  nav button {
    font-size: 17px; padding: 10px 18px; border: 1px solid var(--line);
    background: var(--card); border-radius: 999px; cursor: pointer; color: var(--ink);
  }
  nav button.active { background: var(--brand); border-color: var(--brand); color: #fff; }
  nav button .badge {
    background: var(--warn); color: #fff; border-radius: 999px;
    font-size: 13px; padding: 1px 8px; margin-left: 6px;
  }
  main { padding: 16px 20px 90px; max-width: 980px; margin: 0 auto; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 16px 18px;
  }
  .card .label { color: var(--muted); font-size: 14px; }
  .card .value { font-size: 30px; font-weight: 700; margin-top: 2px; }
  .card .hint { color: var(--muted); font-size: 14px; margin-top: 4px; }
  h2 { font-size: 19px; margin: 22px 0 10px; }
  table { width: 100%; border-collapse: collapse; background: var(--card);
          border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 15px; }
  th { background: var(--brand-soft); color: var(--brand); font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
  tr:last-child td { border-bottom: none; }
  .money { font-variant-numeric: tabular-nums; font-weight: 600; }
  .review-item {
    background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 14px 16px; margin-bottom: 10px;
  }
  .review-item pre {
    white-space: pre-wrap; font-family: inherit; margin: 6px 0 10px;
    background: var(--bg); border-radius: 8px; padding: 10px;
  }
  .review-item .meta { color: var(--muted); font-size: 13px; }
  .review-item .reason { background: #fff7ed; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
  button.action {
    font-size: 16px; padding: 10px 18px; border-radius: 10px; border: none;
    background: var(--brand); color: #fff; cursor: pointer;
  }
  button.action.secondary { background: var(--card); color: var(--ink); border: 1px solid var(--line); }
  .toolbar { display: flex; gap: 10px; align-items: center; margin: 12px 0; flex-wrap: wrap; }
  input[type="date"], input[type="text"] {
    font-size: 17px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px;
  }
  #chat-log { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
  .bubble { max-width: 85%; padding: 12px 14px; border-radius: 14px; white-space: pre-wrap; }
  .bubble.you { align-self: flex-end; background: var(--brand); color: #fff; }
  .bubble.bot { align-self: flex-start; background: var(--card); border: 1px solid var(--line); }
  .bubble.thinking { color: var(--muted); font-style: italic; }
  .mode-chip { display: inline-block; font-size: 12px; color: var(--muted); margin-top: 6px; }
  #toast {
    display: none; position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
    background: #1e2430; color: #fff; padding: 12px 18px; border-radius: 10px; z-index: 20;
  }
  #chat-form { display: flex; gap: 10px; position: fixed; bottom: 0; left: 0; right: 0;
               background: var(--card); border-top: 1px solid var(--line); padding: 12px 20px; }
  #chat-form input { flex: 1; }
  .empty { color: var(--muted); padding: 18px; text-align: center; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<div id="status-banner"></div>
<header>
  <h1>🌸 Bring My Flowers</h1>
  <span class="sub" id="today-label"></span>
</header>
<nav>
  <button data-tab="home" class="active">Home</button>
  <button data-tab="deliveries">Deliveries</button>
  <button data-tab="money">Money</button>
  <button data-tab="review">Review <span class="badge hidden" id="review-badge"></span></button>
  <button data-tab="chat">Ask the bot</button>
</nav>
<main>
  <section id="tab-home">
    <div class="cards" id="overview-cards"><div class="empty">Loading…</div></div>
    <div class="toolbar">
      <button class="action" id="download-sheet">⬇️ Download tomorrow's sheet</button>
    </div>
  </section>

  <section id="tab-deliveries" class="hidden">
    <div class="toolbar">
      <label for="deliveries-date">Date:</label>
      <input type="date" id="deliveries-date">
      <button class="action secondary" id="deliveries-refresh">Show</button>
      <button class="action" id="deliveries-sheet">⬇️ Sheet for this date</button>
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
    <p class="sub" style="color:var(--muted)">Messages the bot did not auto-apply. Read the reason, handle it in Updates/Master, then mark done.</p>
    <div id="review-list"></div>
  </section>

  <section id="tab-chat" class="hidden">
    <div id="chat-log">
      <div class="bubble bot">Ask me anything about the business — deliveries, payments, a customer, stock to buy.</div>
    </div>
  </section>
</main>
<div id="toast"></div>
<form id="chat-form" class="hidden">
  <input type="text" id="chat-input" placeholder="Type your question…" autocomplete="off">
  <button class="action" type="submit">Send</button>
</form>

<script>
const rupees = n => '₹' + Math.round(n).toLocaleString('en-IN');
const el = id => document.getElementById(id);

function toast(msg) {
  const node = el('toast');
  node.textContent = msg;
  node.style.display = 'block';
  setTimeout(() => { node.style.display = 'none'; }, 4000);
}

function switchTab(name) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  for (const tab of ['home', 'deliveries', 'money', 'review', 'chat']) {
    el('tab-' + tab).classList.toggle('hidden', tab !== name);
  }
  el('chat-form').classList.toggle('hidden', name !== 'chat');
  if (name === 'home') loadOverview();
  if (name === 'deliveries') loadDeliveries();
  if (name === 'money') { loadCollections(); loadRenewals(); }
  if (name === 'review') loadReview();
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

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
  if (rows.length === 0) return '<div class="empty">Nothing here 🎉</div>';
  return '<table><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr>' +
    rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table>';
}

function applyHealth(health) {
  const banner = el('status-banner');
  if (!health) { banner.style.display = 'none'; return; }
  if (health.whatsappConnected && health.linked && health.updatesGroupConfigured) {
    banner.className = 'ok';
    banner.style.display = 'block';
    banner.textContent = 'WhatsApp online · Updates group connected · Sheets on this dashboard (no personal DM)';
    return;
  }
  banner.className = '';
  banner.style.display = 'block';
  const parts = [];
  if (!health.linked) parts.push('WhatsApp not linked — <a href="/link">open Link page to scan QR</a>');
  else if (!health.whatsappConnected) parts.push('WhatsApp offline' + (health.lastError ? ': ' + health.lastError : '') + ' — wait, or reopen the app');
  if (!health.updatesGroupConfigured) parts.push('UPDATES_GROUP_JID missing in .env');
  banner.innerHTML = parts.join(' · ');
}

async function loadOverview() {
  try {
    const data = await getJson('/api/overview');
    el('today-label').textContent = data.today.date + ' · ' + (data.qaMode || '');
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
    el('review-list').innerHTML = '<div class="empty">All clear — nothing needs review 🎉</div>';
    return;
  }
  el('review-list').innerHTML = data.items.map(item =>
    '<div class="review-item" id="review-' + item.id + '">' +
      '<div class="meta">From ' + item.participant + ' · ' + (item.received_at || item.created_at) +
        ' · ' + (item.classification || '') + '</div>' +
      '<div class="reason"><strong>Why:</strong> ' + (item.escalation_reason || 'Needs review').replace(/</g, '&lt;') +
        '<br><strong>Do this:</strong> ' + (item.suggestedAction || '').replace(/</g, '&lt;') + '</div>' +
      '<pre>' + item.message_text.replace(/</g, '&lt;') + '</pre>' +
      '<button class="action" onclick="resolveReview(' + item.id + ')">✓ Handled it</button>' +
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
    el('thinking').outerHTML = '<div class="bubble bot">⚠️ ' + (e.message || 'Something went wrong') + '</div>';
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
<meta name="theme-color" content="#b83280">
<title>Link WhatsApp — Bring My Flowers</title>
<style>
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: #f6f7f9; color: #1e2430;
         display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 24px; }
  .box { background: #fff; border: 1px solid #e4e7ec; border-radius: 16px; padding: 28px; max-width: 420px; text-align: center; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { color: #667085; }
  #qr { margin: 18px auto; min-height: 320px; }
  #qr img { width: 280px; height: 280px; }
  .status { font-weight: 600; margin-top: 12px; }
  a.btn { display: inline-block; margin-top: 16px; background: #b83280; color: #fff; text-decoration: none;
          padding: 10px 18px; border-radius: 10px; }
</style>
</head>
<body>
  <div class="box">
    <h1>Link WhatsApp</h1>
    <p>On the business phone: WhatsApp → Linked Devices → Link a Device → scan this QR.</p>
    <div id="qr"><p>Waiting for QR…</p></div>
    <div class="status" id="status">Starting…</div>
    <a class="btn" href="/">Open dashboard</a>
  </div>
<script>
async function refresh() {
  try {
    const health = await fetch('/api/health').then(r => r.json());
    const status = document.getElementById('status');
    if (health.whatsappConnected && health.linked) {
      status.textContent = 'Connected ✓ — you can open the dashboard.';
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

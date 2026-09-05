const XLSX = require('xlsx');
const fs = require('fs');

const dates = ['2026-07-15', '2026-07-16', '2026-07-22', '2026-07-30'];

function readRows(path, sheetHint) {
  const wb = XLSX.readFile(path);
  const sheetName = wb.SheetNames.includes(sheetHint) ? sheetHint : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const header = rows[0];
  const idxOf = (name) => header.findIndex(h => (h || '').trim() === name);
  const idIdx = idxOf('ID');
  const nameIdx = idxOf('Name');
  const packIdx = idxOf('Pack');
  const typeIdx = header.findIndex(h => (h || '').trim() === 'Type');
  const f1Idx = idxOf('Flower 1');
  const s1Idx = f1Idx + 1;
  const f2Idx = idxOf('Flower 2');
  const s2Idx = f2Idx + 1;
  const f3Idx = idxOf('Flower 3');
  const s3Idx = f3Idx + 1;

  const byId = new Map();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[idIdx]) continue;
    const id = String(r[idIdx]).trim();
    byId.set(id, {
      id,
      name: (r[nameIdx] || '').trim(),
      pack: (r[packIdx] || '').trim(),
      type: (r[typeIdx] || '').trim(),
      flower1: (r[f1Idx] || '').trim(),
      stick1: (r[s1Idx] || '').trim(),
      flower2: (r[f2Idx] || '').trim(),
      stick2: (r[s2Idx] || '').trim(),
      flower3: (r[f3Idx] || '').trim(),
      stick3: (r[s3Idx] || '').trim(),
    });
  }
  return byId;
}

const summary = [];

for (const date of dates) {
  const unclePath = `sandbox/reconcile/uncle-${date}.xlsx`;
  const botPath = `sandbox/reconcile/bot-${date}.xlsx`;
  if (!fs.existsSync(unclePath) || !fs.existsSync(botPath)) continue;

  const uncle = readRows(unclePath, 'Sheet1');
  const bot = readRows(botPath, 'Sheet1');

  const uncleIds = new Set(uncle.keys());
  const botIds = new Set(bot.keys());

  const missingFromBot = [...uncleIds].filter(id => !botIds.has(id));
  const extraInBot = [...botIds].filter(id => !uncleIds.has(id));
  const common = [...uncleIds].filter(id => botIds.has(id));

  const flowerMismatches = [];
  for (const id of common) {
    const u = uncle.get(id);
    const b = bot.get(id);
    if (u.flower1 !== b.flower1 || u.stick1 !== b.stick1 || u.flower2 !== b.flower2 || u.flower3 !== b.flower3) {
      flowerMismatches.push({ id, name: u.name, uncle: `${u.flower1}(${u.stick1})/${u.flower2}(${u.stick2})/${u.flower3}(${u.stick3})`, bot: `${b.flower1}(${b.stick1})/${b.flower2}(${b.stick2})/${b.flower3}(${b.stick3})` });
    }
  }

  summary.push({
    date,
    uncleCount: uncleIds.size,
    botCount: botIds.size,
    commonCount: common.length,
    missingFromBotCount: missingFromBot.length,
    extraInBotCount: extraInBot.length,
    flowerMismatchCount: flowerMismatches.length,
    missingFromBotSample: missingFromBot.slice(0, 10).map(id => `${id}:${uncle.get(id).name}`),
    extraInBotSample: extraInBot.slice(0, 10).map(id => `${id}:${bot.get(id).name}`),
    flowerMismatchSample: flowerMismatches.slice(0, 8),
  });
}

console.log(JSON.stringify(summary, null, 2));

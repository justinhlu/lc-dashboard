#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROGRESS_FILE = path.join(process.env.HOME, 'leetcode-progress.md');
const ATTEMPTS_FILE = path.join(process.env.HOME, '.claude', 'learning', 'leetcode-attempts.json');
const PORT = 3848;
const TARGET_TIMES = { easy: 15, medium: 25, hard: 40 };
// Each problem's contribution to weighted progress is its difficulty value.
// Hard problems take longer to crack and lock in patterns; easy ones less so.
const DIFF_WEIGHT = { easy: 1, medium: 2, hard: 3 };
const problemWeight = p => DIFF_WEIGHT[p.diff] ?? 1;

// Days until a problem should be reattempted, based on how it went last time.
// Revisit: tight loop — re-solve as memory is just starting to fade.
// Fluent: graduated schedule (Anki-style) — each successful re-review pushes next one further.
function computeDueDays(solo, status, history = [], isKey = false) {
  if (status === 'revisit') {
    if (solo === 'N') return 1;
    if (solo === 'H') return 2;
    if (solo === 'Y') return 4;
    return 4;
  }
  if (status === 'fluent') {
    // Consecutive-fluent streak, counting the new attempt being recorded.
    let streak = 1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].status === 'fluent') streak++;
      else break;
    }
    const schedule = [7, 21, 60, 180];
    const idx = Math.min(streak - 1, schedule.length - 1);
    const interval = schedule[idx];
    return isKey ? Math.min(interval, 30) : interval;  // key problems capped at 30d
  }
  return null;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  const t1 = new Date(y1, m1 - 1, d1).getTime();
  const t2 = new Date(y2, m2 - 1, d2).getTime();
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

function loadAttempts() {
  try { return JSON.parse(fs.readFileSync(ATTEMPTS_FILE, 'utf8')); }
  catch { return {}; }
}

function saveAttempts(attempts) {
  fs.mkdirSync(path.dirname(ATTEMPTS_FILE), { recursive: true });
  // Snapshot the previous version to .bak before overwriting, so a single bug
  // can't silently destroy state.
  try {
    if (fs.existsSync(ATTEMPTS_FILE)) {
      fs.copyFileSync(ATTEMPTS_FILE, ATTEMPTS_FILE + '.bak');
    }
  } catch (_) {}
  fs.writeFileSync(ATTEMPTS_FILE, JSON.stringify(attempts, null, 2));
}

function computeStreak(attempts) {
  const dates = new Set();
  for (const name in attempts) {
    const rec = attempts[name];
    if (rec && Array.isArray(rec.history)) {
      for (const h of rec.history) if (h && h.date) dates.add(h.date);
    }
    if (rec && rec.lastDate) dates.add(rec.lastDate);
  }
  if (dates.size === 0) return { current: 0, best: 0, lastActive: null };

  const sorted = [...dates].sort();
  // Longest run of consecutive calendar dates anywhere in history.
  let best = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (addDays(sorted[i - 1], 1) === sorted[i]) {
      run++;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }

  // Current streak ends today (or yesterday with grace — streak doesn't break until day rolls past).
  const today = todayStr();
  const yest = addDays(today, -1);
  let cursor = dates.has(today) ? today : (dates.has(yest) ? yest : null);
  let current = 0;
  while (cursor && dates.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    last7.push({ date: d, active: dates.has(d), isToday: d === today });
  }

  return { current, best, lastActive: sorted[sorted.length - 1], last7 };
}

function dayLetter(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][day];
}

function recordAttempt(name, { time, solo, status, isKey }) {
  const attempts = loadAttempts();
  const today = todayStr();
  const prior = attempts[name] || { history: [] };
  const dueDays = computeDueDays(solo, status, prior.history, isKey);
  attempts[name] = {
    ...prior,  // preserve existing fields like `notes` so edits don't wipe them
    lastDate: today,
    solo, status, time,
    dueDate: dueDays != null ? addDays(today, dueDays) : null,
    history: [...prior.history, { date: today, solo, status, time }].slice(-20),
  };
  saveAttempts(attempts);
}

const SLUG_OVERRIDES = {
  'longest substring without repeating chars': 'longest-substring-without-repeating-characters',
  'implement trie': 'implement-trie-prefix-tree',
  'number of connected components': 'number-of-connected-components-in-an-undirected-graph',
  'construct binary tree from preorder and inorder': 'construct-binary-tree-from-preorder-and-inorder-traversal',
};

function leetcodeUrl(name) {
  const key = name.toLowerCase().trim();
  const slug = SLUG_OVERRIDES[key] || key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `https://leetcode.com/problems/${slug}/`;
}

function regexEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateRow(md, name, time, solo, status) {
  const lines = md.split('\n');
  const re = new RegExp(`^\\|\\s*${regexEscape(name)}(?:\\s*\\(key\\))?\\s*\\|`);
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    const cells = lines[i].split('|');
    if (cells.length !== 8) continue;
    const diff = cells[2].trim();
    if (!['easy', 'medium', 'hard'].includes(diff)) continue;
    const isKey = /\(key\)/.test(cells[1]);
    cells[4] = ` ${time} `;
    cells[5] = ` ${solo} `;
    cells[6] = ` ${status} `;
    lines[i] = cells.join('|');
    return { updated: true, newMd: lines.join('\n'), isKey };
  }
  return { updated: false };
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '', size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { req.destroy(); reject(new Error('body too large')); return; }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleNotes(req, res) {
  try {
    const body = await readBody(req, 16384);
    const data = JSON.parse(body);
    const name = String(data.name || '').trim();
    const notes = String(data.notes ?? '');
    if (!name || name.length > 200) throw new Error('invalid name');
    if (notes.length > 10000) throw new Error('notes too long');

    const attempts = loadAttempts();
    if (!attempts[name]) attempts[name] = { history: [] };
    if (notes.trim()) attempts[name].notes = notes;
    else delete attempts[name].notes;
    saveAttempts(attempts);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Error: ' + err.message);
  }
}

async function handleUpdate(req, res) {
  try {
    const body = await readBody(req);
    const data = JSON.parse(body);
    const name = String(data.name || '').trim();
    const time = String(data.time ?? '').trim();
    const solo = String(data.solo ?? '').trim().toUpperCase();
    const status = String(data.status ?? '').trim().toLowerCase();
    if (!name || name.length > 200) throw new Error('invalid name');
    if (time && (/[|\n]/.test(time) || time.length > 30)) throw new Error('invalid time');
    if (solo && !['Y', 'H', 'N'].includes(solo)) throw new Error('invalid solo');
    if (status && !['fluent', 'revisit'].includes(status)) throw new Error('invalid status');

    const md = fs.readFileSync(PROGRESS_FILE, 'utf8');
    const result = updateRow(md, name, time, solo, status);
    if (!result.updated) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('problem not found: ' + name);
    }
    fs.writeFileSync(PROGRESS_FILE, result.newMd);
    recordAttempt(name, { time, solo, status, isKey: result.isKey });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Error: ' + err.message);
  }
}

function parseProgress(md) {
  const modules = [];
  const sections = md.split(/^## Module /m);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const headerMatch = section.match(/^(\d+): (.+)$/m);
    if (!headerMatch) continue;

    const id = parseInt(headerMatch[1], 10);
    const title = headerMatch[2].trim();
    const problems = [];

    const lines = section.split('\n');
    let inTable = false;
    let isTarget = false;

    for (const line of lines) {
      if (line.startsWith('|')) {
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        if (!inTable) {
          inTable = true;
          isTarget = cells[0] === 'Problem' && cells.length === 6;
          continue;
        }
        if (cells.every(c => /^-+$/.test(c))) continue;
        if (isTarget && cells.length === 6) {
          const [problem, diff, pattern, time, solo, status] = cells;
          const isKey = /\(key\)/.test(problem);
          const name = problem.replace(/\(key\)/g, '').trim();
          problems.push({ name, diff, pattern, time, solo, status, isKey });
        }
      } else {
        inTable = false;
      }
    }

    modules.push({ id, title, problems });
  }

  const weakMatch = md.match(/## Notes \/ weak spots to revisit([\s\S]*?)$/);
  const weakSpots = [];
  if (weakMatch) {
    for (const raw of weakMatch[1].split('\n')) {
      const m = raw.match(/^- (.+)$/);
      if (m && !m[1].trim().startsWith('_')) weakSpots.push(m[1].trim());
    }
  }

  return { modules, weakSpots };
}

function computeStats(modules) {
  let total = 0, fluent = 0, revisit = 0, attempted = 0, recovered = 0;
  let keyTotal = 0, keyFluent = 0;
  const timeByDiff = { easy: [], medium: [], hard: [] };
  let soloY = 0, soloDenom = 0;

  for (const mod of modules) {
    for (const p of mod.problems) {
      total++;
      if (p.isKey) keyTotal++;
      if (p.time || p.status) attempted++;

      if (p.status === 'fluent') {
        fluent++;
        if (p.isKey) keyFluent++;
        const t = parseInt(p.time, 10);
        if (!isNaN(t) && timeByDiff[p.diff]) timeByDiff[p.diff].push(t);
        if (Array.isArray(p.history) && p.history.some(h => h.status === 'revisit')) recovered++;
      } else if (p.status === 'revisit') {
        revisit++;
      }
      // Solo rate spans any attempted problem (fluent OR revisit), not just fluent.
      if ((p.status === 'fluent' || p.status === 'revisit') && p.solo) {
        soloDenom++;
        if (p.solo.toUpperCase() === 'Y') soloY++;
      }
    }
  }

  const avgTime = {};
  for (const diff of Object.keys(timeByDiff)) {
    const arr = timeByDiff[diff];
    avgTime[diff] = arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  }

  return {
    total, fluent, revisit, attempted, recovered,
    keyTotal, keyFluent,
    avgTime,
    soloRate: soloDenom ? Math.round(100 * soloY / soloDenom) : null,
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderCharts(modules) {
  const diffs = ['easy', 'medium', 'hard'];
  const byDiff = { easy: { solved: 0, revisit: 0, todo: 0 }, medium: { solved: 0, revisit: 0, todo: 0 }, hard: { solved: 0, revisit: 0, todo: 0 } };
  const timesByDiff = { easy: [], medium: [], hard: [] };
  const soloCounts = { Y: 0, H: 0, N: 0 };

  for (const m of modules) {
    for (const p of m.problems) {
      if (!diffs.includes(p.diff)) continue;
      if (p.status === 'fluent') {
        byDiff[p.diff].solved++;
        const t = parseInt(p.time, 10);
        if (!isNaN(t)) timesByDiff[p.diff].push({ t, name: p.name });
      } else if (p.status === 'revisit') {
        byDiff[p.diff].revisit++;
      } else {
        byDiff[p.diff].todo++;
      }
      // Help-level breakdown includes every attempted problem, fluent or revisit.
      if (p.status === 'fluent' || p.status === 'revisit') {
        const s = (p.solo || '').toUpperCase();
        if (soloCounts.hasOwnProperty(s)) soloCounts[s]++;
      }
    }
  }

  // --- Chart 1: Stacked bars by difficulty ---
  const W1 = 560, labelW = 70, countW = 90, barW = W1 - labelW - countW, rowH = 36;
  const h1 = diffs.length * rowH + 30;
  const barH1 = 18, radius1 = barH1 / 2;
  const clipDefs = diffs.map((d, i) => {
    const y = i * rowH + 18;
    return `<clipPath id="diff-bar-${d}"><rect x="${labelW}" y="${y}" width="${barW}" height="${barH1}" rx="${radius1}" ry="${radius1}" /></clipPath>`;
  }).join('');
  const stackRows = diffs.map((d, i) => {
    const b = byDiff[d];
    const total = b.solved + b.revisit + b.todo;
    const y = i * rowH + 18;
    const sw = total ? (b.solved / total) * barW : 0;
    const rw = total ? (b.revisit / total) * barW : 0;
    return `
      <text x="0" y="${y + 14}" fill="#bbb" font-size="13">${d}</text>
      <g clip-path="url(#diff-bar-${d})">
        <rect x="${labelW}" y="${y}" width="${barW}" height="${barH1}" fill="#353946" />
        <rect x="${labelW}" y="${y}" width="${sw}" height="${barH1}" fill="#4ade80" />
        <rect x="${labelW + sw}" y="${y}" width="${rw}" height="${barH1}" fill="#fbbf24" />
      </g>
      ${b.solved ? `<text x="${labelW + sw / 2}" y="${y + 13}" fill="#15181f" font-size="11" font-weight="600" text-anchor="middle">${b.solved}</text>` : ''}
      <text x="${labelW + barW + 8}" y="${y + 14}" fill="#999" font-size="12">${b.solved}/${total}</text>
    `;
  }).join('');
  const legend1 = `
    <g transform="translate(${labelW}, ${h1 - 4})">
      <rect x="0" y="0" width="10" height="10" rx="2" ry="2" fill="#4ade80" /><text x="14" y="9" fill="#bbb" font-size="11">solved</text>
      <rect x="70" y="0" width="10" height="10" rx="2" ry="2" fill="#fbbf24" /><text x="84" y="9" fill="#bbb" font-size="11">revisit</text>
      <rect x="140" y="0" width="10" height="10" rx="2" ry="2" fill="#353946" stroke="#464a58" /><text x="154" y="9" fill="#bbb" font-size="11">to solve</text>
    </g>`;
  const chart1 = `<svg viewBox="0 0 ${W1} ${h1 + 20}" width="100%" preserveAspectRatio="xMinYMin meet"><defs>${clipDefs}</defs>${stackRows}${legend1}</svg>`;

  // --- Chart 2: Solve time strip per difficulty ---
  const allTimes = diffs.flatMap(d => timesByDiff[d].map(x => x.t));
  const maxTime = Math.max(50, ...allTimes, ...Object.values(TARGET_TIMES)) * 1.15;
  const W2 = 560, plotW = W2 - labelW - 10, diffH = 44;
  const h2 = diffs.length * diffH + 24;
  const xTicks = [0, 15, 25, 40, 60].filter(t => t <= maxTime);
  const gridLines = xTicks.map(t => {
    const x = labelW + (t / maxTime) * plotW;
    return `<line x1="${x}" y1="10" x2="${x}" y2="${h2 - 14}" stroke="#2c303a" stroke-dasharray="2,3" />
            <text x="${x}" y="${h2 - 2}" fill="#555" font-size="10" text-anchor="middle">${t}m</text>`;
  }).join('');
  const stripRows = diffs.map((d, i) => {
    const y = i * diffH + 30;
    const target = TARGET_TIMES[d];
    const tx = labelW + (target / maxTime) * plotW;
    const dots = timesByDiff[d].map(({ t, name }) => {
      const x = labelW + (t / maxTime) * plotW;
      const color = t <= target ? '#4ade80' : '#f87171';
      return `<circle cx="${x}" cy="${y}" r="5" fill="${color}" opacity="0.9"><title>${escapeHtml(name)}: ${t} min</title></circle>`;
    }).join('');
    return `
      <text x="0" y="${y + 4}" fill="#bbb" font-size="13">${d}</text>
      <line x1="${labelW}" y1="${y}" x2="${labelW + plotW}" y2="${y}" stroke="#2c303a" />
      <line x1="${tx}" y1="${y - 12}" x2="${tx}" y2="${y + 12}" stroke="#888" stroke-dasharray="3,2" stroke-width="1.5" />
      <text x="${tx}" y="${y - 15}" fill="#888" font-size="10" text-anchor="middle">${target}m</text>
      ${dots}
    `;
  }).join('');
  const chart2 = `<svg viewBox="0 0 ${W2} ${h2 + 4}" width="100%" preserveAspectRatio="xMinYMin meet">${gridLines}${stripRows}</svg>`;

  // --- Chart 3: Solo breakdown (horizontal bar) ---
  const soloTotal = soloCounts.Y + soloCounts.H + soloCounts.N;
  const soloSvg = soloTotal === 0
    ? `<p class="muted">no solved problems yet</p>`
    : (() => {
        const W3 = 560, barY = 10, barH = 24, legendY = 62, h3 = 82;
        const yw = (soloCounts.Y / soloTotal) * W3;
        const hw = (soloCounts.H / soloTotal) * W3;
        const nw = (soloCounts.N / soloTotal) * W3;
        const pct = v => Math.round(100 * v / soloTotal);
        return `<svg viewBox="0 0 ${W3} ${h3}" width="100%" preserveAspectRatio="xMinYMin meet">
          <defs>
            <clipPath id="help-chart-clip">
              <rect x="0" y="${barY}" width="${W3}" height="${barH}" rx="${barH / 2}" ry="${barH / 2}" />
            </clipPath>
          </defs>
          <g clip-path="url(#help-chart-clip)">
            <rect x="0" y="${barY}" width="${yw}" height="${barH}" fill="#4ade80" />
            <rect x="${yw}" y="${barY}" width="${hw}" height="${barH}" fill="#fbbf24" />
            <rect x="${yw + hw}" y="${barY}" width="${nw}" height="${barH}" fill="#f87171" />
          </g>
          ${yw > 30 ? `<text x="${yw / 2}" y="${barY + 16}" fill="#15181f" font-size="12" font-weight="600" text-anchor="middle">${pct(soloCounts.Y)}%</text>` : ''}
          ${hw > 30 ? `<text x="${yw + hw / 2}" y="${barY + 16}" fill="#15181f" font-size="12" font-weight="600" text-anchor="middle">${pct(soloCounts.H)}%</text>` : ''}
          ${nw > 30 ? `<text x="${yw + hw + nw / 2}" y="${barY + 16}" fill="#15181f" font-size="12" font-weight="600" text-anchor="middle">${pct(soloCounts.N)}%</text>` : ''}
          <g transform="translate(0, ${legendY})">
            <rect x="0" y="0" width="10" height="10" rx="2" ry="2" fill="#4ade80" /><text x="16" y="9" fill="#bbb" font-size="11">solo (${soloCounts.Y})</text>
            <rect x="105" y="0" width="10" height="10" rx="2" ry="2" fill="#fbbf24" /><text x="121" y="9" fill="#bbb" font-size="11">hint (${soloCounts.H})</text>
            <rect x="200" y="0" width="10" height="10" rx="2" ry="2" fill="#f87171" /><text x="216" y="9" fill="#bbb" font-size="11">read solution (${soloCounts.N})</text>
          </g>
        </svg>`;
      })();

  return `
    <div class="charts">
      <div class="chart"><h3>Progress by difficulty</h3>${chart1}</div>
      <div class="chart"><h3>Solve time vs target (fluent only)</h3>${chart2}</div>
      <div class="chart"><h3>Help needed (all attempted problems)</h3>${soloSvg}</div>
    </div>`;
}

const LIGHT_MODE_RULES = `
  body { background: #ebeff7; color: #15171c; }
  h2 { color: #475569; }
  .sub { color: #475569; }
  .hero-num { color: #15171c; }
  .hero-total { color: #64748b; }
  .pct-big { color: #16a34a; }

  .mastery-bar { background: #d8dde6; border-color: #b8bfca; }
  .mastery-val { color: #16a34a; }
  .mastery-note { color: #64748b; }

  .tile { background: linear-gradient(180deg, #ffffff 0%, #fafbff 100%); border-color: #b8bfca; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.02); }
  .tile h4 { color: #475569; }
  .tile .small { color: #64748b; }
  .tile.good .big { color: #16a34a; }
  .tile.bad .big { color: #dc2626; }
  .tile.streak.on-fire { background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%); border-color: #f97316; }
  .tile.streak.on-fire .big { color: #c2410c; }
  .tile.streak.on-fire h4 { color: #9a3412; }
  .streak-unit { color: #94a3b8; }

  .week-tracker { background: none; border: none; box-shadow: none; }
  .week-label { color: #475569; }
  .week-stat { color: #16a34a; }
  .day-square { background: #d8dde6; }
  .day.active .day-square { background: linear-gradient(135deg, #22c55e, #16a34a); box-shadow: 0 0 4px rgba(22, 163, 74, 0.35); }
  .day.missed .day-square { background: linear-gradient(135deg, #ef4444, #b91c1c); box-shadow: 0 0 4px rgba(239, 68, 68, 0.3); }
  .day.today .day-square { background: #d8dde6; box-shadow: 0 0 0 2px #d97706, 0 0 6px rgba(217, 119, 6, 0.35); }
  .day.today.active .day-square { background: linear-gradient(135deg, #22c55e, #16a34a); box-shadow: 0 0 0 2px #d97706, 0 0 6px rgba(22, 163, 74, 0.5); }
  .day-letter { color: #64748b; }
  .day.today .day-letter { color: #b45309; }

  .card { background: linear-gradient(180deg, #ffffff 0%, #fafbff 100%); border-color: #b8bfca; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.02); }
  .card h3 { color: #15171c; }
  .card .pct { color: #16a34a; }
  .card .muted { color: #475569; }
  .card.completed { background: linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%); border-color: #d97706; box-shadow: 0 0 16px rgba(217, 119, 6, 0.22); }
  .card.completed .pct { color: #b45309; }

  .bar { background: #d8dde6; border-color: #b8bfca; }

  .chart { background: linear-gradient(180deg, #ffffff 0%, #fafbff 100%); border-color: #b8bfca; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.02); }
  .chart h3 { color: #475569; }
  .chart svg text[fill="#bbb"] { fill: #475569 !important; }
  .chart svg text[fill="#999"] { fill: #475569 !important; }
  .chart svg text[fill="#888"] { fill: #475569 !important; }
  .chart svg text[fill="#555"] { fill: #64748b !important; }
  .chart svg line[stroke="#2c303a"] { stroke: #b8bfca !important; }
  .chart svg rect[fill="#353946"] { fill: #d8dde6 !important; }
  .chart svg rect[fill="#353946"][stroke="#464a58"] { stroke: #94a3b8 !important; }

  /* Tinted backgrounds for the open status sections inside module cards */
  details[open] > summary.solved ~ ul { background: rgba(34, 197, 94, 0.07); border-radius: 6px; padding: 10px 14px 10px 28px; }
  details[open] > summary.revisit ~ ul { background: rgba(217, 119, 6, 0.08); border-radius: 6px; padding: 10px 14px 10px 28px; }
  details[open] > summary.todo ~ ul { background: rgba(37, 99, 235, 0.06); border-radius: 6px; padding: 10px 14px 10px 28px; }
  summary.solved { color: #15803d; }
  summary.revisit { color: #b45309; }
  summary.todo { color: #1d4ed8; }

  ul li a { color: #15171c; border-bottom-color: #94a3b8; }
  ul li a:hover { color: #2563eb; border-bottom-color: #2563eb; }
  ul li a:visited { color: #7c3aed; }
  ul li .meta { color: #475569; }
  .row-main { color: #15171c; }

  .key { background: linear-gradient(90deg, #fef3c7, #fde68a); color: #92400e; }

  .edit-btn { border-color: #b8bfca; color: #475569; }
  .edit-btn:hover { border-color: #2563eb; color: #2563eb; background: rgba(37, 99, 235, 0.06); }
  .notes-btn { border-color: #b8bfca; color: #475569; }
  .notes-btn:hover { border-color: #d97706; color: #d97706; background: rgba(217, 119, 6, 0.06); }
  .notes-btn.has-notes { border-color: #d97706; color: #b45309; background: rgba(217, 119, 6, 0.12); }

  .edit-form { background: linear-gradient(180deg, #f0f4ff 0%, #f0f2f6 100%); border-color: #b8bfca; }
  .edit-form label { color: #475569; }
  .edit-form input, .edit-form select { background: #ffffff; border-color: #94a3b8; color: #15171c; }
  .edit-form button { background: linear-gradient(180deg, #22c55e, #16a34a); color: #ffffff; }
  .edit-form button:hover { background: linear-gradient(180deg, #16a34a, #15803d); }
  .edit-form button.cancel { background: #e5e7eb; color: #475569; }
  .edit-form button.cancel:hover { background: #d1d5db; }
  .edit-hint { color: #64748b; border-top-color: #b8bfca; }
  .edit-hint b { color: #475569; }

  .notes-panel { background: linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%); border-color: #fcd34d; }
  .notes-panel textarea { background: #ffffff; border-color: #94a3b8; color: #15171c; }
  .notes-panel button { background: linear-gradient(180deg, #22c55e, #16a34a); color: #ffffff; }
  .notes-panel button:hover { background: linear-gradient(180deg, #16a34a, #15803d); }
  .notes-panel button.cancel { background: #e5e7eb; color: #475569; }
  .notes-panel button.cancel:hover { background: #d1d5db; }

  .next-card { background: linear-gradient(135deg, #d1fae5 0%, #cffafe 100%); border-color: #5eead4; }
  .next-card.is-revisit { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-color: #fbbf24; }
  .next-card.is-review { background: linear-gradient(135deg, #dbeafe 0%, #bae6fd 100%); border-color: #60a5fa; }
  .next-card.done { background: linear-gradient(135deg, #e0f2fe 0%, #f1f5f9 100%); border-color: #94a3b8; }
  .next-label { color: #15803d; }
  .is-revisit .next-label { color: #b45309; }
  .is-review .next-label { color: #1d4ed8; }
  .done .next-label { color: #1d4ed8; }
  .next-title { color: #15171c; }
  .next-title:hover { color: #15803d; }
  .is-revisit .next-title:hover { color: #b45309; }
  .is-review .next-title:hover { color: #1d4ed8; }
  .next-meta { color: #475569; }
  .next-meta .dot { color: #94a3b8; }
  .next-meta .muted-inline { color: #475569; }
  .next-meta .diff-easy { color: #15803d; }
  .next-meta .diff-medium { color: #b45309; }
  .next-meta .diff-hard { color: #b91c1c; }
  .next-meta .due-label { color: #b45309; }
  .next-prev { color: #475569; }

  .ts { color: #64748b; }

  .theme-toggle { background: #ffffff; border-color: #b8bfca; }
  .theme-toggle button { color: #475569; }
  .theme-toggle button:hover { background: #f1f5f9; color: #15171c; }
  .theme-toggle button.active { background: linear-gradient(180deg, #2563eb, #1d4ed8); color: #ffffff; }
`;

function renderHtml(stats, modules, weakSpots, streak = { current: 0, best: 0, lastActive: null }) {
  const today = todayStr();
  const renderItem = (p, opts = {}) => {
    const bits = [];
    if (opts.showStatus && p.status) bits.push(escapeHtml(p.status));
    if (p.time) bits.push(`${escapeHtml(p.time)} min`);
    if (p.solo) bits.push(`solo=${escapeHtml(p.solo)}`);
    if (opts.showDiff) bits.push(escapeHtml(p.diff));
    if (p.lastDate) {
      const age = daysBetween(p.lastDate, today);
      const ageStr = age === 0 ? 'today' : age === 1 ? '1d ago' : `${age}d ago`;
      bits.push(`last ${ageStr}`);
    }
    if ((p.status === 'revisit' || p.status === 'fluent') && p.dueDate) {
      const diff = daysBetween(today, p.dueDate);
      const label = p.status === 'fluent' ? 'review' : 'due';
      if (diff > 0) bits.push(`${label} in ${diff}d`);
      else if (diff === 0) bits.push(`${label} today`);
      else bits.push(`overdue ${-diff}d`);
    } else if (p.status === 'revisit' && !p.dueDate) {
      bits.push('due today');
    }
    const meta = bits.join(' · ');
    const url = leetcodeUrl(p.name);
    const curTime = escapeHtml(p.time || '');
    const curSolo = (p.solo || '').toUpperCase();
    const curStatus = (p.status || '').toLowerCase();
    const soloLabels = { '': '— not set', 'Y': 'Y · solved solo, no help', 'H': 'H · used a hint', 'N': 'N · read the solution' };
    const statusLabels = { '': '— not attempted', 'fluent': 'fluent · could re-solve cold', 'revisit': 'revisit · slow, hinted, or barely passed' };
    const soloOpts = Object.entries(soloLabels).map(([v, lbl]) => `<option value="${v}"${v === curSolo ? ' selected' : ''}>${lbl}</option>`).join('');
    const statusOpts = Object.entries(statusLabels).map(([v, lbl]) => `<option value="${v}"${v === curStatus ? ' selected' : ''}>${lbl}</option>`).join('');
    const hasNotes = !!(p.notes && p.notes.trim());
    return `<li>
      <span class="row-main">
        <a href="${url}" target="_blank" rel="noopener">${escapeHtml(p.name)}</a>${p.isKey ? ' <span class="key">key</span>' : ''}${meta ? ` <span class="meta">— ${meta}</span>` : ''}
        <button class="notes-btn${hasNotes ? ' has-notes' : ''}" onclick="toggleNotes(this)" title="${hasNotes ? 'View/edit notes' : 'Add notes'}">notes${hasNotes ? ' •' : ''}</button>
        <button class="edit-btn" onclick="toggleEdit(this)">edit</button>
      </span>
      <form class="notes-panel" hidden data-name="${escapeHtml(p.name)}" onsubmit="return saveNotes(this, event)">
        <textarea name="notes" rows="3" placeholder="Key insight, gotcha, or pattern reminder for this problem…">${escapeHtml(p.notes || '')}</textarea>
        <div class="notes-actions">
          <button type="submit">save</button>
          <button type="button" class="cancel" onclick="this.closest('form').hidden=true">cancel</button>
        </div>
      </form>
      <form class="edit-form" hidden data-name="${escapeHtml(p.name)}" onsubmit="return saveEdit(this, event)">
        <label title="Minutes from first read to working solution. Target: easy ≤15, medium ≤25, hard ≤40.">time (min) <input type="text" name="time" value="${curTime}" placeholder="e.g. 18" size="7"></label>
        <label title="How much help did you need?">help <select name="solo">${soloOpts}</select></label>
        <label title="fluent = you could re-solve cold tomorrow. revisit = needs another pass.">status <select name="status">${statusOpts}</select></label>
        <button type="submit">save</button>
        <button type="button" class="cancel" onclick="this.closest('form').hidden=true">cancel</button>
        <div class="edit-hint">
          <span><b>time:</b> target easy ≤15 · medium ≤25 · hard ≤40</span>
          <span><b>help:</b> Y solo · H hint · N read solution</span>
          <span><b>status:</b> fluent = re-solvable cold · revisit = needs another pass</span>
        </div>
      </form>
    </li>`;
  };

  const moduleCards = modules.map(m => {
    const total = m.problems.length;
    const solvedList = m.problems.filter(p => p.status === 'fluent');
    const revisitList = m.problems.filter(p => p.status === 'revisit');
    const todoList = m.problems.filter(p => p.status !== 'fluent' && p.status !== 'revisit');
    const moduleTotalW = m.problems.reduce((s, p) => s + problemWeight(p), 0);
    const solvedW = solvedList.reduce((s, p) => s + problemWeight(p), 0);
    const pct = moduleTotalW ? Math.round(100 * solvedW / moduleTotalW) : 0;
    const completed = total > 0 && solvedList.length === total;

    const renderList = (arr, opts) => arr.map(p => renderItem(p, opts)).join('');

    return `
      <div class="card${completed ? ' completed' : ''}">
        <div class="card-head">
          <h3>Module ${m.id}: ${escapeHtml(m.title)}${completed ? ' <span class="complete-badge">complete</span>' : ''}</h3>
          <span class="pct">${pct}%</span>
        </div>
        <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
        <p class="muted">${solvedList.length}/${total} solved${revisitList.length ? ` · ${revisitList.length} revisit` : ''} · ${todoList.length} to solve</p>
        ${todoList.length ? `<details open><summary class="todo">To solve (${todoList.length})</summary><ul>${renderList(todoList, { showDiff: true })}</ul></details>` : ''}
        ${revisitList.length ? `<details open><summary class="revisit">Revisit (${revisitList.length})</summary><ul>${renderList(revisitList, { showDiff: true })}</ul></details>` : ''}
        ${solvedList.length ? `<details><summary class="solved">Solved (${solvedList.length})</summary><ul>${renderList(solvedList, { showDiff: true })}</ul></details>` : ''}
      </div>`;
  }).join('');

  const timeTiles = ['easy', 'medium', 'hard'].map(diff => {
    const avg = stats.avgTime[diff];
    const target = TARGET_TIMES[diff];
    let cls = '', note = 'no data';
    if (avg != null) {
      cls = avg <= target ? 'good' : 'bad';
      note = avg <= target ? `under target (${target})` : `over target (${target})`;
    }
    return `<div class="tile ${cls}"><h4>${diff}</h4><p class="big">${avg ?? '—'}${avg != null ? ' min' : ''}</p><p class="small">${note}</p></div>`;
  }).join('');

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>LeetCode Progress</title>
<script>
(function () {
  try {
    var s = localStorage.getItem('theme');
    if (s === 'light' || s === 'dark') document.documentElement.setAttribute('data-theme', s);
  } catch (e) {}
})();
</script>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 0; background: #15181f; color: #e6e6e6; }
  main { max-width: 960px; margin: 0 auto; padding: 28px 24px 60px; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 14px; margin: 32px 0 12px; color: #8a8a8a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
  h3 { font-size: 15px; margin: 0; }
  h4 { font-size: 11px; margin: 0; color: #888; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
  .hero { display: flex; align-items: baseline; gap: 2px; margin: 18px 0 2px; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .hero-num { font-size: 52px; font-weight: 700; }
  .hero-total { font-size: 28px; font-weight: 600; color: #666; margin-left: 2px; }
  .pct-big { color: #4ade80; font-size: 28px; font-weight: 700; margin-left: 16px; }
  .mastery { margin: 14px 0 4px; }
  .mastery-bar { position: relative; background: #21252e; height: 12px; border-radius: 6px; overflow: hidden; border: 1px solid #2c303a; }
  .mastery-fluent {
    position: absolute; left: 0; top: 0; height: 100%;
    background:
      linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 100%),
      linear-gradient(90deg, #4ade80 0%, #22d3ee 100%);
    background-size: 35% 100%, 100% 100%;
    background-position: -35% 0, 0 0;
    background-repeat: no-repeat;
    animation: liquid-flow 2.8s linear infinite;
    box-shadow: 0 0 8px rgba(74, 222, 128, 0.35);
  }
  .mastery-revisit {
    position: absolute; top: 0; height: 100%;
    background: repeating-linear-gradient(45deg, #fbbf24 0 6px, #b97c0b 6px 12px);
    opacity: 0.85;
    animation: stripe-flow 1.5s linear infinite;
  }
  @keyframes liquid-flow {
    0%   { background-position: -35% 0, 0 0; }
    100% { background-position: 135% 0, 0 0; }
  }
  @keyframes stripe-flow {
    0%   { background-position: 0 0; }
    100% { background-position: 17px 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .mastery-fluent, .mastery-revisit { animation: none; }
  }
  .mastery-label { display: flex; justify-content: space-between; align-items: center; margin: 8px 0 0; font-size: 12px; }
  .mastery-val { color: #4ade80; font-weight: 700; letter-spacing: 0.02em; }
  .mastery-note { font-size: 11px; color: #666; }
  .sub { color: #888; margin: 0; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 12px 0; }
  .tile { background: #1f2230; border-radius: 10px; padding: 14px 16px; border: 1px solid #2c303a; }
  .tile .big { font-size: 22px; font-weight: 700; margin: 6px 0 2px; }
  .tile .small { font-size: 11px; color: #777; margin: 0; }
  .tile.good .big { color: #4ade80; }
  .tile.bad .big { color: #f87171; }
  .tile.streak.on-fire { background: linear-gradient(135deg, #2a1f10 0%, #1f2230 100%); border-color: #6b3a0e; }
  .tile.streak.on-fire .big { color: #fbbf24; }
  .tile.streak.on-fire h4 { color: #d97706; }
  .streak-unit { font-size: 13px; font-weight: 600; color: #777; margin-left: 4px; }
  .hero-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; flex-wrap: wrap; margin: 18px 0 6px; }
  .hero-left { display: flex; flex-direction: column; }
  .hero-left .hero { margin: 0; }
  .hero-left .sub { margin-top: 4px; }
  .week-tracker { display: flex; flex-direction: column; gap: 8px; align-self: flex-end; padding-bottom: 4px; background: none; border: none; }
  .week-head { display: flex; align-items: baseline; gap: 8px; }
  .week-label { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; }
  .week-stat { font-size: 11px; color: #4ade80; font-weight: 700; font-variant-numeric: tabular-nums; }
  .week-dots { display: flex; gap: 4px; }
  .day { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .day-square { width: 18px; height: 18px; border-radius: 4px; background: #353946; transition: transform 0.15s; }
  .day.active .day-square { background: linear-gradient(135deg, #4ade80, #22c55e); box-shadow: 0 0 4px rgba(74, 222, 128, 0.45); }
  .day.missed .day-square { background: linear-gradient(135deg, #f87171, #dc2626); box-shadow: 0 0 4px rgba(248, 113, 113, 0.35); }
  .day.today .day-square { background: #353946; box-shadow: 0 0 0 2px #fbbf24, 0 0 6px rgba(251, 191, 36, 0.4); }
  .day.today.active .day-square { background: linear-gradient(135deg, #4ade80, #22c55e); box-shadow: 0 0 0 2px #fbbf24, 0 0 6px rgba(74, 222, 128, 0.6); }
  .day-letter { font-size: 9px; color: #777; font-weight: 600; letter-spacing: 0.04em; }
  .day.today .day-letter { color: #fbbf24; }
  .card { background: #1f2230; border: 1px solid #2c303a; border-radius: 10px; padding: 16px; margin-bottom: 10px; }
  .card-head { display: flex; justify-content: space-between; align-items: baseline; }
  .pct { font-weight: 700; color: #4ade80; font-variant-numeric: tabular-nums; }
  .bar { position: relative; background: #21252e; height: 12px; border-radius: 6px; overflow: hidden; margin: 10px 0; border: 1px solid #2c303a; }
  .fill {
    position: absolute; left: 0; top: 0; height: 100%;
    background:
      linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 100%),
      linear-gradient(90deg, #4ade80 0%, #22d3ee 100%);
    background-size: 35% 100%, 100% 100%;
    background-position: -35% 0, 0 0;
    background-repeat: no-repeat;
    animation: liquid-flow 2.8s linear infinite;
    box-shadow: 0 0 8px rgba(74, 222, 128, 0.35);
  }
  @media (prefers-reduced-motion: reduce) { .fill { animation: none; } }
  .card.completed { border-color: #a87a1e; box-shadow: 0 0 18px rgba(251, 191, 36, 0.15); background: linear-gradient(135deg, #2a2418 0%, #1f2230 100%); }
  .card.completed .pct { color: #fbbf24; }
  .card.completed .fill {
    background:
      linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0) 100%),
      linear-gradient(90deg, #fbbf24 0%, #f59e0b 50%, #fde68a 100%);
    background-size: 35% 100%, 100% 100%;
    background-position: -35% 0, 0 0;
    background-repeat: no-repeat;
    box-shadow: 0 0 14px rgba(251, 191, 36, 0.55);
  }
  .complete-badge {
    display: inline-block; background: linear-gradient(90deg, #fbbf24, #f59e0b); color: #15181f;
    font-size: 9px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
    padding: 2px 8px; border-radius: 3px; margin-left: 10px; vertical-align: middle;
  }
  .muted { color: #888; margin: 0; font-size: 13px; }
  details { margin-top: 10px; }
  summary { cursor: pointer; font-size: 13px; user-select: none; padding: 4px 0; }
  summary.solved { color: #4ade80; }
  summary.revisit { color: #fbbf24; }
  summary.todo { color: #60a5fa; }
  ul { margin: 8px 0 0; padding-left: 20px; color: #ccc; font-size: 13px; }
  ul li { margin: 3px 0; }
  ul li a { color: #e6e6e6; text-decoration: none; border-bottom: 1px dotted #555; }
  ul li a:hover { color: #60a5fa; border-bottom-color: #60a5fa; }
  ul li a:visited { color: #c4b5fd; }
  .row-main { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .edit-btn { background: none; border: 1px solid #333; color: #888; font-size: 10px; padding: 1px 7px; border-radius: 3px; margin-left: 8px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.06em; font-family: inherit; }
  .edit-btn:hover { border-color: #60a5fa; color: #60a5fa; }
  .edit-form { display: flex; gap: 8px; align-items: center; margin: 6px 0 4px; padding: 8px 10px; background: #181b23; border-radius: 6px; border: 1px solid #2c303a; flex-wrap: wrap; font-size: 12px; }
  .edit-form[hidden] { display: none; }
  .edit-form label { color: #888; display: flex; align-items: center; gap: 4px; }
  .edit-form input, .edit-form select { background: #1f2230; border: 1px solid #2d3038; color: #e6e6e6; font: inherit; padding: 3px 6px; border-radius: 3px; }
  .edit-form button { background: #4ade80; color: #15181f; border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-weight: 700; font-size: 12px; font-family: inherit; }
  .edit-form button:hover { background: #22c55e; }
  .edit-form button.cancel { background: #353946; color: #ccc; }
  .edit-form button.cancel:hover { background: #33363e; }
  .edit-form button:disabled { opacity: 0.5; cursor: wait; }
  .edit-hint { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 14px; font-size: 11px; color: #777; padding-top: 6px; border-top: 1px solid #2c303a; margin-top: 2px; }
  .edit-hint b { color: #aaa; font-weight: 600; }
  .notes-btn { background: none; border: 1px solid #333; color: #888; font-size: 10px; padding: 1px 7px; border-radius: 3px; margin-left: 6px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.06em; font-family: inherit; }
  .notes-btn:hover { border-color: #fbbf24; color: #fbbf24; }
  .notes-btn.has-notes { border-color: #fbbf24; color: #fbbf24; background: rgba(251, 191, 36, 0.08); }
  .notes-panel { flex-direction: column; gap: 8px; margin: 6px 0 4px; padding: 10px 12px; background: #181b23; border-radius: 6px; border: 1px solid #2c303a; display: flex; }
  .notes-panel[hidden] { display: none; }
  .notes-panel textarea { background: #1f2230; border: 1px solid #2d3038; color: #e6e6e6; font: 13px/1.5 -apple-system, system-ui, sans-serif; padding: 6px 8px; border-radius: 3px; resize: vertical; min-height: 56px; width: 100%; box-sizing: border-box; }
  .notes-actions { display: flex; gap: 8px; }
  .notes-panel button { background: #4ade80; color: #15181f; border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-weight: 700; font-size: 12px; font-family: inherit; }
  .notes-panel button:hover { background: #22c55e; }
  .notes-panel button.cancel { background: #353946; color: #ccc; }
  .notes-panel button.cancel:hover { background: #33363e; }
  .notes-panel button:disabled { opacity: 0.5; cursor: wait; }
  .key { background: #3b2d0a; color: #fbbf24; font-size: 10px; padding: 1px 6px; border-radius: 3px; letter-spacing: 0.05em; text-transform: uppercase; }
  .meta { color: #888; }
  .next-card { background: linear-gradient(135deg, #1a2f1f 0%, #162028 100%); border: 1px solid #2d4a35; border-radius: 12px; padding: 20px 22px; margin: 20px 0 8px; }
  .next-card.is-revisit { background: linear-gradient(135deg, #2f2818 0%, #28201a 100%); border-color: #4a3d2d; }
  .next-card.is-review { background: linear-gradient(135deg, #182538 0%, #162030 100%); border-color: #2d4060; }
  .next-card.done { background: linear-gradient(135deg, #1f2a3a 0%, #1a2230 100%); border-color: #2d3a4a; }
  .next-label { font-size: 11px; color: #4ade80; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; }
  .is-revisit .next-label { color: #fbbf24; }
  .is-review .next-label { color: #60a5fa; }
  .done .next-label { color: #60a5fa; }
  .next-title { font-size: 22px; font-weight: 700; color: #fff; text-decoration: none; letter-spacing: -0.01em; }
  .next-title:hover { color: #4ade80; }
  .is-revisit .next-title:hover { color: #fbbf24; }
  .is-review .next-title:hover { color: #60a5fa; }
  .next-meta { margin-top: 10px; font-size: 13px; color: #ccc; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .next-meta .dot { color: #444; }
  .next-meta .muted-inline { color: #888; }
  .next-meta .diff-easy { color: #4ade80; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
  .next-meta .diff-medium { color: #fbbf24; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
  .next-meta .diff-hard { color: #f87171; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
  .next-meta .due-label { color: #fbbf24; font-weight: 600; }
  .next-prev { margin: 10px 0 0; font-size: 12px; color: #999; font-style: italic; }
  .next-actions { margin-top: 14px; display: flex; gap: 8px; }
  .next-card .edit-btn, .next-card .notes-btn { margin-left: 0; font-size: 11px; padding: 3px 10px; }
  .charts { display: grid; gap: 12px; }
  .chart { background: #1f2230; border: 1px solid #2c303a; border-radius: 10px; padding: 16px 18px; }
  .chart h3 { font-size: 13px; color: #999; font-weight: 600; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  .chart svg { max-width: 100%; height: auto; display: block; }
  .ts { color: #555; font-size: 11px; margin-top: 32px; text-align: center; }

  .theme-toggle { display: inline-flex; gap: 0; background: #1f2230; border: 1px solid #2c303a; border-radius: 999px; padding: 2px; margin: 28px auto 8px; }
  main { display: flex; flex-direction: column; }
  main > .theme-toggle { align-self: center; }
  .theme-toggle button { background: none; border: none; color: #888; padding: 3px 9px; font: 9px/1 -apple-system, system-ui, sans-serif; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; border-radius: 999px; transition: all 0.15s; }
  .theme-toggle button:hover { background: rgba(255, 255, 255, 0.05); color: #e6e6e6; }
  .theme-toggle button.active { background: linear-gradient(180deg, #4ade80, #22c55e); color: #15181f; }

  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) { ${LIGHT_MODE_RULES} }
  }
  :root[data-theme="light"] { ${LIGHT_MODE_RULES} }
</style>
</head><body>
<main>

<h1>LeetCode FAANG Prep</h1>
<div class="hero-row">
  <div class="hero-left">
    <div class="hero"><span class="hero-num">${stats.fluent}</span><span class="hero-total">/${stats.total}</span><span class="pct-big">${stats.total ? Math.round(100 * stats.fluent / stats.total) : 0}%</span></div>
    <p class="sub">problems fluent · ${stats.revisit} to revisit · ${stats.attempted} attempted</p>
  </div>
  <div class="week-tracker" aria-label="Activity over the past 7 days">
    <div class="week-head"><span class="week-label">past 7 days</span><span class="week-stat">${streak.last7 ? streak.last7.filter(d => d.active).length : 0}/7</span></div>
    <div class="week-dots">
      ${(streak.last7 || []).map(d => {
        const state = d.isToday ? `today${d.active ? ' active' : ''}` : (d.active ? 'active' : 'missed');
        const tip = d.isToday
          ? `${d.date} — today${d.active ? ' (logged)' : ' (not yet)'}`
          : `${d.date} — ${d.active ? 'logged' : 'no activity'}`;
        return `<div class="day ${state}" title="${tip}"><div class="day-square"></div><span class="day-letter">${dayLetter(d.date)}</span></div>`;
      }).join('')}
    </div>
  </div>
</div>

${(() => {
  const REVISIT_WEIGHT = 0.5;
  let totalW = 0, fluentW = 0, revisitW = 0;
  for (const m of modules) for (const p of m.problems) {
    const w = problemWeight(p);
    totalW += w;
    if (p.status === 'fluent') fluentW += w;
    else if (p.status === 'revisit') revisitW += w;
  }
  const fluentPct = totalW ? 100 * fluentW / totalW : 0;
  const revisitContribPct = totalW ? 100 * revisitW * REVISIT_WEIGHT / totalW : 0;
  const mastery = Math.round(fluentPct + revisitContribPct);
  return `
    <div class="mastery">
      <div class="mastery-bar">
        <div class="mastery-fluent" style="width: ${fluentPct.toFixed(2)}%"></div>
        <div class="mastery-revisit" style="left: ${fluentPct.toFixed(2)}%; width: ${revisitContribPct.toFixed(2)}%"></div>
      </div>
      <p class="mastery-label">
        <span class="mastery-val">${mastery}% mastery</span>
        <span class="mastery-note" title="Each problem contributes its difficulty value (easy=1, medium=2, hard=3). Revisit counts at half credit.">fluent 100% · revisit 50% · weighted easy 1 · med 2 · hard 3</span>
      </p>
    </div>`;
})()}

${(() => {
  const today = todayStr();
  const effectiveDue = p => {
    if (p.status === 'revisit' && !p.dueDate) return today; // no record → treat as due today
    return p.dueDate;
  };
  const isDue = p => {
    if (p.status === 'revisit') return !p.dueDate || p.dueDate <= today;
    if (p.status === 'fluent') return p.dueDate && p.dueDate <= today;
    return false;
  };
  const isScheduled = p => (p.status === 'revisit' || p.status === 'fluent') && p.dueDate && p.dueDate > today;
  const isNew = p => p.status !== 'fluent' && p.status !== 'revisit';

  // Everything due today or overdue, oldest due-date first so nothing rots.
  const dueList = [];
  for (const m of modules) for (const p of m.problems) if (isDue(p)) dueList.push({ p, m, ed: effectiveDue(p) });
  dueList.sort((a, b) => (a.ed || '0') < (b.ed || '0') ? -1 : 1);

  let next = null, nextMod = null, kind = '';
  if (dueList.length) {
    next = dueList[0].p;
    nextMod = dueList[0].m;
    kind = next.status === 'fluent' ? 'review' : 'revisit';
  } else {
    for (const m of modules) {
      for (const p of m.problems) if (isNew(p)) { next = p; nextMod = m; kind = 'new'; break; }
      if (next) break;
    }
  }

  const scheduledCount = modules.flatMap(m => m.problems).filter(isScheduled).length;
  const reviewScheduled = modules.flatMap(m => m.problems).filter(p => p.status === 'fluent' && p.dueDate && p.dueDate > today).length;
  const revisitScheduled = scheduledCount - reviewScheduled;

  if (!next) {
    const parts = [];
    if (revisitScheduled) parts.push(`${revisitScheduled} revisit${revisitScheduled === 1 ? '' : 's'}`);
    if (reviewScheduled) parts.push(`${reviewScheduled} fluent review${reviewScheduled === 1 ? '' : 's'}`);
    const msg = parts.length
      ? `Nothing due today. ${parts.join(' and ')} scheduled for later.`
      : `Every problem is fluent and nothing is scheduled. Time for mocks.`;
    return `<div class="next-card done"><h2 class="next-label">All caught up</h2><p>${msg}</p></div>`;
  }

  const target = TARGET_TIMES[next.diff] ?? '—';
  const url = leetcodeUrl(next.name);
  const cardClass = kind === 'revisit' ? ' is-revisit' : kind === 'review' ? ' is-review' : '';
  const label = kind === 'revisit' ? 'Revisit due' : kind === 'review' ? 'Fluent review due' : 'Next up';

  let dueLabel = '';
  if (kind !== 'new') {
    if (next.dueDate) {
      const diff = daysBetween(next.dueDate, today);
      dueLabel = diff === 0 ? 'due today' : diff > 0 ? `overdue by ${diff} day${diff === 1 ? '' : 's'}` : '';
    } else {
      dueLabel = 'due today';
    }
  }
  const prevMeta = kind !== 'new'
    ? [next.time && `last time: ${escapeHtml(next.time)} min`, next.solo && `solo=${escapeHtml(next.solo)}`, next.lastDate && `attempted ${next.lastDate}`].filter(Boolean).join(' · ')
    : '';
  const scheduledBits = [];
  if (revisitScheduled) scheduledBits.push(`${revisitScheduled} revisit${revisitScheduled === 1 ? '' : 's'}`);
  if (reviewScheduled) scheduledBits.push(`${reviewScheduled} fluent review${reviewScheduled === 1 ? '' : 's'}`);
  const scheduledLine = scheduledBits.length ? `<p class="next-prev">+ ${scheduledBits.join(' and ')} scheduled for later</p>` : '';

  // Edit & notes forms for the featured problem — reuse the same toggle/save JS as the module lists.
  const nextCurTime = escapeHtml(next.time || '');
  const nextCurSolo = (next.solo || '').toUpperCase();
  const nextCurStatus = (next.status || '').toLowerCase();
  const nextSoloLabels = { '': '— not set', 'Y': 'Y · solved solo, no help', 'H': 'H · used a hint', 'N': 'N · read the solution' };
  const nextStatusLabels = { '': '— not attempted', 'fluent': 'fluent · could re-solve cold', 'revisit': 'revisit · slow, hinted, or barely passed' };
  const nextSoloOpts = Object.entries(nextSoloLabels).map(([v, lbl]) => `<option value="${v}"${v === nextCurSolo ? ' selected' : ''}>${lbl}</option>`).join('');
  const nextStatusOpts = Object.entries(nextStatusLabels).map(([v, lbl]) => `<option value="${v}"${v === nextCurStatus ? ' selected' : ''}>${lbl}</option>`).join('');
  const nextHasNotes = !!(next.notes && next.notes.trim());

  return `
    <div class="next-card${cardClass}">
      <h2 class="next-label">${label}</h2>
      <a class="next-title" href="${url}" target="_blank" rel="noopener">${escapeHtml(next.name)} →</a>
      ${next.isKey ? ' <span class="key">key</span>' : ''}
      <div class="next-meta">
        <span class="diff-${next.diff}">${escapeHtml(next.diff)}</span>
        <span class="dot">·</span>
        <span>${escapeHtml(next.pattern || '—')}</span>
        <span class="dot">·</span>
        <span>target ${target} min</span>
        ${dueLabel ? `<span class="dot">·</span><span class="due-label">${dueLabel}</span>` : ''}
        <span class="dot">·</span>
        <span class="muted-inline">Module ${nextMod.id}: ${escapeHtml(nextMod.title)}</span>
      </div>
      ${prevMeta ? `<p class="next-prev">${prevMeta}</p>` : ''}
      ${scheduledLine}
      <div class="next-actions">
        <button class="notes-btn${nextHasNotes ? ' has-notes' : ''}" onclick="toggleNotes(this)" title="${nextHasNotes ? 'View/edit notes' : 'Add notes'}">notes${nextHasNotes ? ' •' : ''}</button>
        <button class="edit-btn" onclick="toggleEdit(this)">edit</button>
      </div>
      <form class="notes-panel" hidden data-name="${escapeHtml(next.name)}" onsubmit="return saveNotes(this, event)">
        <textarea name="notes" rows="3" placeholder="Key insight, gotcha, or pattern reminder for this problem…">${escapeHtml(next.notes || '')}</textarea>
        <div class="notes-actions">
          <button type="submit">save</button>
          <button type="button" class="cancel" onclick="this.closest('form').hidden=true">cancel</button>
        </div>
      </form>
      <form class="edit-form" hidden data-name="${escapeHtml(next.name)}" onsubmit="return saveEdit(this, event)">
        <label title="Minutes from first read to working solution. Target: easy ≤15, medium ≤25, hard ≤40.">time (min) <input type="text" name="time" value="${nextCurTime}" placeholder="e.g. 18" size="7"></label>
        <label title="How much help did you need?">help <select name="solo">${nextSoloOpts}</select></label>
        <label title="fluent = you could re-solve cold tomorrow. revisit = needs another pass.">status <select name="status">${nextStatusOpts}</select></label>
        <button type="submit">save</button>
        <button type="button" class="cancel" onclick="this.closest('form').hidden=true">cancel</button>
        <div class="edit-hint">
          <span><b>time:</b> target easy ≤15 · medium ≤25 · hard ≤40</span>
          <span><b>help:</b> Y solo · H hint · N read solution</span>
          <span><b>status:</b> fluent = re-solvable cold · revisit = needs another pass</span>
        </div>
      </form>
    </div>`;
})()}

${(() => {
  const today = todayStr();
  let streakSub;
  if (streak.current === 0) streakSub = 'log a problem to start';
  else if (streak.lastActive === today) streakSub = `best ${streak.best}`;
  else streakSub = `update today to keep it · best ${streak.best}`;
  return `
    <h2>Summary</h2>
    <div class="row">
      <div class="tile streak${streak.current > 0 ? ' on-fire' : ''}"><h4>Streak</h4><p class="big">${streak.current}<span class="streak-unit"> ${streak.current === 1 ? 'day' : 'days'}</span></p><p class="small">${streakSub}</p></div>
      <div class="tile"><h4>Key problems</h4><p class="big">${stats.keyFluent}/${stats.keyTotal}</p><p class="small">must-be-fluent fluent</p></div>
      <div class="tile"><h4>Solo rate</h4><p class="big">${stats.soloRate ?? '—'}${stats.soloRate != null ? '%' : ''}</p><p class="small">of attempted, solved w/o help</p></div>
      <div class="tile"><h4>Recovered</h4><p class="big">${stats.recovered}</p><p class="small">revisit → fluent</p></div>
    </div>`;
})()}

<h2>Avg time (fluent only)</h2>
<div class="row">${timeTiles}</div>

<h2>Analytics</h2>
${renderCharts(modules)}

<h2>Modules</h2>
${moduleCards}

${weakSpots.length ? `<h2>Weak spots</h2><div class="card"><ul>${weakSpots.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>` : ''}

<div class="theme-toggle" role="group" aria-label="Color theme">
  <button type="button" data-theme-set="auto">Auto</button>
  <button type="button" data-theme-set="light">Light</button>
  <button type="button" data-theme-set="dark">Dark</button>
</div>
<p class="ts">edits save to ${escapeHtml(PROGRESS_FILE)} · auto-refresh every 30s when idle</p>
</main>
<script>
function toggleEdit(btn) {
  const form = btn.closest('li, .next-card').querySelector('.edit-form');
  form.hidden = !form.hidden;
  if (!form.hidden) { const f = form.querySelector('input,select'); f && f.focus(); }
}
function toggleNotes(btn) {
  const panel = btn.closest('li, .next-card').querySelector('.notes-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) { const ta = panel.querySelector('textarea'); ta && ta.focus(); }
}
async function saveNotes(form, ev) {
  ev.preventDefault();
  const data = { name: form.dataset.name, notes: form.elements.notes.value };
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'saving…';
  try {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    location.reload();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'save';
    alert('Save failed: ' + err.message);
  }
  return false;
}
async function saveEdit(form, ev) {
  ev.preventDefault();
  const data = {
    name: form.dataset.name,
    time: form.elements.time.value.trim(),
    solo: form.elements.solo.value,
    status: form.elements.status.value,
  };
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'saving…';
  try {
    const res = await fetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    location.reload();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'save';
    alert('Save failed: ' + err.message);
  }
  return false;
}
setInterval(() => {
  if (!document.querySelector('.edit-form:not([hidden]), .notes-panel:not([hidden])')) location.reload();
}, 30000);

(function setupThemeToggle() {
  function current() {
    try { var s = localStorage.getItem('theme'); return (s === 'light' || s === 'dark') ? s : 'auto'; }
    catch (e) { return 'auto'; }
  }
  function apply(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    try { t === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', t); }
    catch (e) {}
    document.querySelectorAll('.theme-toggle button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.themeSet === t);
    });
  }
  apply(current());
  document.querySelectorAll('.theme-toggle button').forEach(function (b) {
    b.addEventListener('click', function () { apply(b.dataset.themeSet); });
  });
})();
</script>
</body></html>`;
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (req.url === '/api/update' && req.method === 'POST') return handleUpdate(req, res);
  if (req.url === '/api/notes' && req.method === 'POST') return handleNotes(req, res);
  try {
    const md = fs.readFileSync(PROGRESS_FILE, 'utf8');
    const { modules, weakSpots } = parseProgress(md);
    const attempts = loadAttempts();
    for (const m of modules) {
      for (const p of m.problems) {
        const a = attempts[p.name];
        p.lastDate = a?.lastDate || null;
        p.dueDate = a?.dueDate || null;
        p.history = a?.history || [];
        p.notes = a?.notes || '';
      }
    }
    const stats = computeStats(modules);
    const streak = computeStreak(attempts);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderHtml(stats, modules, weakSpots, streak));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Error: ' + err.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`LeetCode dashboard → http://localhost:${PORT}`);
});

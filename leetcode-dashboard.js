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

// NeetCode uses its own slug scheme that often differs from LeetCode (e.g. "two-integer-sum" vs "two-sum").
// Mapped entries link to NeetCode; unmapped problems fall back to the LeetCode URL.
const NEETCODE_SLUGS = {
  // Arrays & Hashing
  'two sum': 'two-integer-sum',
  'contains duplicate': 'duplicate-integer',
  'valid anagram': 'is-anagram',
  'group anagrams': 'anagram-groups',
  'top k frequent elements': 'top-k-elements-in-list',
  'product of array except self': 'products-of-array-discluding-self',
  // Two Pointers
  'valid palindrome': 'is-palindrome',
  '3sum': 'three-integer-sum',
  'container with most water': 'max-water-container',
  'trapping rain water': 'trapping-rain-water',
  // Sliding Window
  'best time to buy and sell stock': 'buy-and-sell-crypto',
  'longest substring without repeating chars': 'longest-substring-without-duplicates',
  'longest substring without repeating characters': 'longest-substring-without-duplicates',
  'longest repeating character replacement': 'longest-repeating-substring-with-replacement',
  'permutation in string': 'permutation-string',
  'minimum window substring': 'minimum-window-with-characters',
  'sliding window maximum': 'sliding-window-maximum',
  // Stack
  'valid parentheses': 'validate-parentheses',
  'min stack': 'minimum-stack',
  'evaluate reverse polish notation': 'evaluate-reverse-polish-notation',
  'generate parentheses': 'generate-parentheses',
  'daily temperatures': 'daily-temperatures',
  'car fleet': 'car-fleet',
  'largest rectangle in histogram': 'largest-rectangle-in-histogram',
  // Binary Search
  'binary search': 'binary-search',
  'search a 2d matrix': 'search-2d-matrix',
  'koko eating bananas': 'eating-bananas',
  'find minimum in rotated sorted array': 'find-minimum-in-rotated-sorted-array',
  'search in rotated sorted array': 'find-target-in-rotated-sorted-array',
  'time based key-value store': 'time-based-key-value-store',
  'median of two sorted arrays': 'median-of-two-sorted-arrays',
  // Linked List
  'reverse linked list': 'reverse-a-linked-list',
  'merge two sorted lists': 'merge-two-sorted-linked-lists',
  'reorder list': 'reorder-linked-list',
  'remove nth node from end of list': 'remove-node-from-end-of-linked-list',
  'copy list with random pointer': 'copy-linked-list-with-random-pointer',
  'add two numbers': 'add-two-numbers',
  'linked list cycle': 'linked-list-cycle-detection',
  'find the duplicate number': 'find-duplicate-integer',
  'lru cache': 'lru-cache',
  'merge k sorted lists': 'merge-k-sorted-linked-lists',
  'reverse nodes in k-group': 'reverse-nodes-in-k-group',
  // Trees
  'invert binary tree': 'invert-a-binary-tree',
  'maximum depth of binary tree': 'depth-of-binary-tree',
  'diameter of binary tree': 'binary-tree-diameter',
  'balanced binary tree': 'balanced-binary-tree',
  'same tree': 'same-binary-tree',
  'subtree of another tree': 'subtree-of-a-binary-tree',
  'lowest common ancestor of a bst': 'lowest-common-ancestor-in-binary-search-tree',
  'binary tree level order traversal': 'level-order-traversal-of-binary-tree',
  'binary tree right side view': 'binary-tree-right-side-view',
  'count good nodes': 'count-good-nodes-in-binary-tree',
  'validate binary search tree': 'valid-binary-search-tree',
  'kth smallest element in a bst': 'kth-smallest-integer-in-bst',
  'construct binary tree from preorder and inorder': 'binary-tree-from-preorder-and-inorder-traversal',
  'binary tree maximum path sum': 'binary-tree-maximum-path-sum',
  'serialize and deserialize binary tree': 'serialize-and-deserialize-binary-tree',
  // Graphs
  'number of islands': 'count-number-of-islands',
  'max area of island': 'max-area-of-island',
  'clone graph': 'clone-graph',
  'walls and gates': 'islands-and-treasure',
  'rotting oranges': 'rotting-fruit',
  'pacific atlantic water flow': 'pacific-atlantic-water-flow',
  'surrounded regions': 'surrounded-regions',
  'course schedule': 'course-schedule',
  'course schedule ii': 'course-schedule-ii',
  'redundant connection': 'redundant-connection',
  'number of connected components': 'count-connected-components',
  'graph valid tree': 'valid-tree',
  'word ladder': 'word-ladder',
  // Advanced Graphs
  'network delay time': 'network-delay-time',
  'swim in rising water': 'swim-in-rising-water',
  'alien dictionary': 'foreign-dictionary',
  'cheapest flights within k stops': 'cheapest-flight-path',
  // Heaps
  'kth largest element in a stream': 'kth-largest-integer-in-a-stream',
  'last stone weight': 'last-stone-weight',
  'k closest points to origin': 'k-closest-points-to-origin',
  'kth largest element in an array': 'kth-largest-integer-in-an-array',
  'task scheduler': 'task-scheduling',
  'design twitter': 'design-twitter-feed',
  'find median from data stream': 'find-median-in-a-data-stream',
  // Intervals
  'insert interval': 'insert-new-interval',
  'merge intervals': 'merge-intervals',
  'non-overlapping intervals': 'non-overlapping-intervals',
  'meeting rooms': 'meeting-schedule',
  'meeting rooms ii': 'meeting-schedule-ii',
  'minimum interval to include each query': 'minimum-interval-including-query',
  // Greedy
  'maximum subarray': 'maximum-subarray',
  'jump game': 'jump-game',
  'jump game ii': 'jump-game-ii',
  'gas station': 'gas-station',
  'hand of straights': 'hand-of-straights',
  'merge triplets to form target': 'merge-triplets-to-form-target',
  'partition labels': 'partition-labels',
  'valid parenthesis string': 'valid-parenthesis-string',
  // 1-D DP
  'climbing stairs': 'climbing-stairs',
  'min cost climbing stairs': 'min-cost-climbing-stairs',
  'house robber': 'house-robber',
  'house robber ii': 'house-robber-ii',
  'longest palindromic substring': 'longest-palindromic-substring',
  'palindromic substrings': 'palindromic-substrings',
  'decode ways': 'decode-ways',
  'coin change': 'coin-change',
  'maximum product subarray': 'maximum-product-subarray',
  'word break': 'word-break',
  'longest increasing subsequence': 'longest-increasing-subsequence',
  'partition equal subset sum': 'partition-equal-subset-sum',
  // 2-D DP
  'unique paths': 'count-paths',
  'longest common subsequence': 'longest-common-subsequence',
  'best time to buy and sell stock with cooldown': 'buy-and-sell-crypto-with-cooldown',
  'coin change ii': 'coin-change-ii',
  'target sum': 'target-sum',
  'interleaving string': 'interleaving-string',
  'longest increasing path in a matrix': 'longest-increasing-path-in-matrix',
  'distinct subsequences': 'count-subsequences',
  'edit distance': 'edit-distance',
  'burst balloons': 'burst-balloons',
  'regular expression matching': 'regular-expression-matching',
  // Backtracking
  'subsets': 'subsets',
  'combination sum': 'combination-target-sum',
  'permutations': 'permutations',
  'subsets ii': 'subsets-ii',
  'combination sum ii': 'combination-target-sum-ii',
  'word search': 'search-for-word',
  'palindrome partitioning': 'palindrome-partitioning',
  'letter combinations of a phone number': 'combinations-of-a-phone-number',
  'n-queens': 'n-queens',
  // Tries
  'implement trie': 'implement-prefix-tree',
  'design add and search words data structure': 'design-word-search-data-structure',
  'word search ii': 'search-for-word-ii',
  // Problems with non-standard URLs — store the full URL (the function detects the "://" prefix)
  'subarray sum equals k': 'https://neetcode.io/problems/subarray-sum-equals-k/question?list=allNC',
  // Bit Manipulation
  'single number': 'single-number',
  'number of 1 bits': 'number-of-one-bits',
  'counting bits': 'counting-bits',
  'reverse bits': 'reverse-bits',
  'missing number': 'missing-number',
  'sum of two integers': 'sum-of-two-integers',
};

function problemUrl(name) {
  const key = name.toLowerCase().trim();
  const ncSlug = NEETCODE_SLUGS[key];
  if (ncSlug) return ncSlug.includes('://') ? ncSlug : `https://neetcode.io/problems/${ncSlug}`;
  // Unmapped problem — land on NeetCode All with the name pre-filled as a search query.
  return `https://neetcode.io/practice?tab=neetcodeAll&search=${encodeURIComponent(name)}`;
}
const leetcodeUrl = problemUrl;

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#4ade80"/>
      <stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="7" fill="url(#g)"/>
  <path d="M8 16.5 L13.5 22 L24 10.5" stroke="#0f1115" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

// Hand-rolled 32x32 PNG fallback (for Safari, which historically chokes on SVG favicons).
// Solid green-cyan rounded square with a darker checkmark — same vibe as the SVG.
const FAVICON_PNG = (() => {
  const zlib = require('zlib');
  const W = 32, H = 32;
  const px = Buffer.alloc(W * H * 4);
  // Lerp between two endpoint colors based on x+y position to mimic the SVG gradient.
  const c1 = [74, 222, 128, 255];   // #4ade80
  const c2 = [34, 211, 238, 255];   // #22d3ee
  const ink = [15, 17, 21, 255];    // #0f1115 (checkmark)
  const radius = 7;
  function inRoundedRect(x, y) {
    if (x >= radius && x < W - radius) return y >= 0 && y < H;
    if (y >= radius && y < H - radius) return x >= 0 && x < W;
    const cx = x < radius ? radius : W - 1 - radius;
    const cy = y < radius ? radius : H - 1 - radius;
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  }
  // Checkmark path: from (8,16.5) -> (13.5,22) -> (24,10.5), stroke width ~4.5
  function distToSegment(x, y, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const apx = x - ax, apy = y - ay;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
    const cx = ax + t * abx, cy = ay + t * aby;
    return Math.hypot(x - cx, y - cy);
  }
  const halfStroke = 2.25;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!inRoundedRect(x + 0.5, y + 0.5)) {
        px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;  // transparent corner
        continue;
      }
      // Gradient fill
      const t = ((x + y) / (W + H - 2));
      let r = c1[0] + (c2[0] - c1[0]) * t;
      let g = c1[1] + (c2[1] - c1[1]) * t;
      let b = c1[2] + (c2[2] - c1[2]) * t;
      // Stroke if near checkmark path
      const fx = x + 0.5, fy = y + 0.5;
      const d = Math.min(
        distToSegment(fx, fy, 8, 16.5, 13.5, 22),
        distToSegment(fx, fy, 13.5, 22, 24, 10.5)
      );
      if (d < halfStroke) {
        const a = Math.min(1, halfStroke - d);  // soft anti-aliased edge
        r = ink[0] * a + r * (1 - a);
        g = ink[1] * a + g * (1 - a);
        b = ink[2] * a + b * (1 - a);
      }
      px[i] = r | 0;
      px[i + 1] = g | 0;
      px[i + 2] = b | 0;
      px[i + 3] = 255;
    }
  }
  // Wrap rows with PNG filter byte (0 = none) and zlib-deflate.
  const filtered = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    filtered[y * (1 + W * 4)] = 0;
    px.copy(filtered, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const idat = zlib.deflateSync(filtered);
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.concat([t, data]);
    let crc = 0xffffffff;
    for (let i = 0; i < crcBuf.length; i++) {
      crc ^= crcBuf[i];
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    const crcOut = Buffer.alloc(4); crcOut.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
    return Buffer.concat([len, t, data, crcOut]);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // 8-bit RGBA
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
})();

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
  const diffColor = { easy: '#4ade80', medium: '#fbbf24', hard: '#f87171' };
  const stripRows = diffs.map((d, i) => {
    const y = i * diffH + 30;
    const target = TARGET_TIMES[d];
    const tx = labelW + (target / maxTime) * plotW;
    const fill = diffColor[d];
    const dots = timesByDiff[d].map(({ t, name }) => {
      const x = labelW + (t / maxTime) * plotW;
      const overTarget = t > target;
      // Same difficulty color; outline highlights problems that blew past their target.
      return `<circle cx="${x}" cy="${y}" r="5.5" fill="${fill}" opacity="0.92"${overTarget ? ' stroke="#f87171" stroke-width="2"' : ''}><title>${escapeHtml(name)}: ${t} min${overTarget ? ' (over target)' : ''}</title></circle>`;
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
  .tile.streak.broken { background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-color: #ef4444; }
  .tile.streak.broken .big { color: #b91c1c; }
  .tile.streak.broken h4 { color: #991b1b; }
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

  .scheduled-section > summary { color: #475569; }
  .scheduled-section > summary:hover { color: #15171c; }
  .sched-chevron { color: #94a3b8; }
  .sched-total-count { background: #d8dde6; color: #475569; }
  .sched-bucket + .sched-bucket { border-top-color: #b8bfca; }
  .sched-bucket h4 { color: #475569; }
  .sched-count { background: #d8dde6; color: #475569; }
  .scheduled-list li:hover { background: rgba(15, 23, 42, 0.04); }
  .sched-when { color: #475569; }
  .sched-when.due-now { color: #b45309; }
  .sched-bucket.sched-today h4 { color: #b45309; }
  .sched-bucket.sched-today .sched-count { background: rgba(217, 119, 6, 0.15); color: #b45309; }
  .sched-later-note { color: #475569; border-top-color: #b8bfca; }
  .sched-kind-revisit { background: rgba(217, 119, 6, 0.12); color: #b45309; }
  .sched-kind-review { background: rgba(37, 99, 235, 0.12); color: #1d4ed8; }
  .sched-mod { color: #94a3b8; }
  .scheduled-list .diff-easy { color: #15803d; }
  .scheduled-list .diff-medium { color: #b45309; }
  .scheduled-list .diff-hard { color: #b91c1c; }

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
  .next-nav-btn { background: rgba(15, 23, 42, 0.06); color: #475569; border-color: rgba(15, 23, 42, 0.08); }
  .next-nav-btn:hover { background: rgba(15, 23, 42, 0.14); color: #15171c; }
  .next-pager { color: #475569; }

  .ts { color: #64748b; }

  .theme-toggle { background: #ffffff; border-color: #b8bfca; }
  .theme-toggle button { color: #475569; }
  .theme-toggle button:hover { background: #f1f5f9; color: #15171c; }
  .theme-toggle button.active { background: linear-gradient(180deg, #2563eb, #1d4ed8); color: #ffffff; }

  /* Boss Rush – light mode */
  .boss-rush-card { background: linear-gradient(135deg, #fff0f3 0%, #fce8ec 100%); border-color: #e94560; box-shadow: 0 1px 3px rgba(233, 69, 96, 0.1); }
  .boss-rush-card.inactive { background: linear-gradient(180deg, #ffffff 0%, #fafbff 100%); border-color: #b8bfca; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08); }
  .boss-rush-card.br-win { background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border-color: #d97706; box-shadow: 0 1px 3px rgba(217, 119, 6, 0.15); }
  .boss-rush-card.br-gameover { background: linear-gradient(135deg, #fff0f0 0%, #fde8e8 100%); border-color: #dc2626; box-shadow: 0 1px 3px rgba(220, 38, 38, 0.1); }
  .boss-rush-title { color: #15171c; }
  .boss-rush-title:hover { color: #e94560; }
  .boss-rush-meta { color: #475569; }
  .boss-rush-hs { color: #475569; }
  .boss-rush-score-label { color: #64748b; }
  .boss-rush-score-sep { color: #94a3b8; }
  .boss-rush-remaining { color: #64748b; }
  .boss-rush-desc { color: #475569; }
  .boss-rush-inactive-label { color: #64748b !important; }
  .br-heart.empty { color: #d1d5db; }
  .br-btn-reset { background: #e5e7eb; color: #475569; }
  .br-hp-recover { color: #16a34a; }
`;

function renderHtml(stats, modules, weakSpots, streak = { current: 0, best: 0, lastActive: null }, nextIdx = 0) {
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
<link rel="icon" type="image/png" sizes="32x32" href="/favicon.png?v=4">
<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=4">
<link rel="apple-touch-icon" href="/favicon.png?v=4">
<meta name="apple-mobile-web-app-title" content="LC Progress">
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
  .tile.streak.broken { background: linear-gradient(135deg, #2a1f1f 0%, #1f2230 100%); border-color: #5a2a2a; }
  .tile.streak.broken .big { color: #f87171; }
  .tile.streak.broken h4 { color: #b45252; }
  .streak-emoji { font-size: 14px; margin-left: 4px; vertical-align: baseline; letter-spacing: -0.05em; }
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

  .scheduled-section { margin: 32px 0 12px; }
  .scheduled-section > summary { list-style: none; cursor: pointer; user-select: none; font-size: 14px; color: #8a8a8a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 12px; padding: 4px 0; display: flex; align-items: center; gap: 6px; }
  .scheduled-section > summary::-webkit-details-marker { display: none; }
  .scheduled-section > summary:hover { color: #ccc; }
  .sched-chevron { display: inline-block; transition: transform 0.2s; font-size: 11px; color: #666; }
  .scheduled-section[open] > summary > .sched-chevron { transform: rotate(90deg); }
  .sched-total-count { background: #2c303a; color: #ccc; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; margin-left: 6px; vertical-align: middle; }
  .scheduled-card { padding: 14px 18px; }
  .sched-bucket + .sched-bucket { margin-top: 14px; padding-top: 14px; border-top: 1px solid #2c303a; }
  .sched-bucket h4 { font-size: 11px; color: #999; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 8px; }
  .sched-count { background: #353946; color: #bbb; font-size: 10px; padding: 1px 6px; border-radius: 999px; margin-left: 4px; }
  .scheduled-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .scheduled-list li { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 13px; padding: 4px 8px; border-radius: 4px; }
  .scheduled-list li:hover { background: rgba(255, 255, 255, 0.03); }
  .sched-when { font-variant-numeric: tabular-nums; color: #999; font-size: 11px; min-width: 56px; font-weight: 600; }
  .sched-when.due-now { color: #fbbf24; }
  .sched-bucket.sched-today h4 { color: #fbbf24; }
  .sched-bucket.sched-today .sched-count { background: rgba(251, 191, 36, 0.18); color: #fbbf24; }
  .sched-later-note { margin: 14px 0 0; padding-top: 12px; border-top: 1px solid #2c303a; font-size: 11px; color: #888; font-style: italic; }
  .sched-kind { font-size: 10px; padding: 1px 7px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
  .sched-kind-revisit { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
  .sched-kind-review { background: rgba(96, 165, 250, 0.15); color: #60a5fa; }
  .sched-mod { color: #666; font-size: 11px; margin-left: auto; }
  .scheduled-list .diff-easy { color: #4ade80; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
  .scheduled-list .diff-medium { color: #fbbf24; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
  .scheduled-list .diff-hard { color: #f87171; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
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
  .next-header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
  .next-nav-row { display: inline-flex; align-items: center; gap: 6px; }
  .next-nav-btn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 999px; background: rgba(255, 255, 255, 0.06); color: #ccc; text-decoration: none; font-size: 16px; font-weight: 700; line-height: 1; border: 1px solid rgba(255, 255, 255, 0.08); transition: background 0.15s, color 0.15s; }
  .next-nav-btn:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }
  .next-pager { font-size: 10px; color: #888; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; font-variant-numeric: tabular-nums; }
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

  /* Boss Rush */
  .boss-rush-card { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border: 1px solid #e94560; border-radius: 12px; padding: 20px 22px; margin: 4px 0 8px; }
  .boss-rush-card.inactive { border-color: #2c303a; background: #1f2230; }
  .boss-rush-card.br-win { border-color: #fbbf24; background: linear-gradient(135deg, #2a2418 0%, #1f2230 100%); }
  .boss-rush-label { font-size: 11px; color: #e94560; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 700; }
  .boss-rush-inactive-label { color: #888 !important; }
  .boss-rush-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .boss-rush-score-row { display: flex; align-items: baseline; gap: 8px; }
  .boss-rush-score-num { font-size: 28px; font-weight: 700; color: #4ade80; font-variant-numeric: tabular-nums; line-height: 1; }
  .boss-rush-score-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.08em; }
  .boss-rush-score-sep { color: #444; }
  .boss-rush-title { font-size: 22px; font-weight: 700; color: #fff; text-decoration: none; letter-spacing: -0.01em; display: block; margin-bottom: 2px; }
  .boss-rush-title:hover { color: #e94560; }
  .boss-rush-meta { font-size: 13px; color: #ccc; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
  .boss-rush-hs { font-size: 13px; color: #aaa; margin: 8px 0 0; }
  .br-hs-val { color: #fbbf24; font-weight: 700; }
  .boss-rush-remaining { font-size: 11px; color: #666; margin: 8px 0 0; }
  .boss-rush-desc { font-size: 13px; color: #888; margin: 4px 0 12px; }
  .boss-rush-win-title { font-size: 24px; font-weight: 700; color: #fbbf24; margin: 4px 0 8px; }
  .boss-rush-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; align-items: center; }
  .br-btn { border: none; padding: 8px 18px; border-radius: 6px; cursor: pointer; font-weight: 700; font-size: 13px; font-family: inherit; transition: opacity 0.15s; }
  .br-btn:hover { opacity: 0.82; }
  .br-btn-start { background: linear-gradient(135deg, #e94560, #c73652); color: #fff; }
  .br-btn-complete { background: linear-gradient(135deg, #4ade80, #22c55e); color: #15181f; }
  .br-btn-fail { background: linear-gradient(135deg, #f87171, #dc2626); color: #fff; }
  .br-btn-reset { background: #353946; color: #ccc; font-size: 11px; padding: 6px 12px; }
  .br-hearts { display: flex; gap: 3px; align-items: center; }
  .br-heart { font-size: 20px; line-height: 1; }
  .br-heart.full { color: #e94560; }
  .br-heart.empty { color: #333; }
  .br-hp-row { display: flex; align-items: center; gap: 10px; margin: 2px 0 12px; }
  .br-hp-recover { font-size: 11px; color: #4ade80; }
  .boss-rush-card.br-gameover { border-color: #dc2626; background: linear-gradient(135deg, #2a1212 0%, #1f2230 100%); }

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

  // Build the full toggle list: every scheduled item (due + future), sorted by effective due date.
  const candidates = [];
  for (const m of modules) for (const p of m.problems) {
    if (p.status === 'revisit' || p.status === 'fluent') {
      const ed = effectiveDue(p);
      if (ed) candidates.push({ p, m, ed, kind: p.status === 'fluent' ? 'review' : 'revisit' });
    }
  }
  candidates.sort((a, b) => a.ed < b.ed ? -1 : a.ed > b.ed ? 1 : 0);

  const scheduledCount = modules.flatMap(m => m.problems).filter(isScheduled).length;
  const reviewScheduled = modules.flatMap(m => m.problems).filter(p => p.status === 'fluent' && p.dueDate && p.dueDate > today).length;
  const revisitScheduled = scheduledCount - reviewScheduled;

  // Render a single next-up card for the given problem. navInfo={idx,total} adds a pager; null = no pager.
  const buildCard = (p, m, kind, navInfo, isVisible) => {
    const target = TARGET_TIMES[p.diff] ?? '—';
    const url = leetcodeUrl(p.name);
    const cardClass = kind === 'revisit' ? ' is-revisit' : kind === 'review' ? ' is-review' : '';
    const label = kind === 'revisit' ? 'Revisit due' : kind === 'review' ? 'Fluent review due' : 'Next up';
    let dueLabel = '';
    if (kind !== 'new') {
      if (p.dueDate) {
        const diff = daysBetween(p.dueDate, today);
        if (diff === 0) dueLabel = 'due today';
        else if (diff > 0) dueLabel = `overdue by ${diff} day${diff === 1 ? '' : 's'}`;
        else dueLabel = `due in ${-diff} day${-diff === 1 ? '' : 's'}`;
      } else {
        dueLabel = 'due today';
      }
    }
    const prevMeta = kind !== 'new'
      ? [p.time && `last time: ${escapeHtml(p.time)} min`, p.solo && `solo=${escapeHtml(p.solo)}`, p.lastDate && `attempted ${p.lastDate}`].filter(Boolean).join(' · ')
      : '';
    const scheduledBits = [];
    if (revisitScheduled) scheduledBits.push(`${revisitScheduled} revisit${revisitScheduled === 1 ? '' : 's'}`);
    if (reviewScheduled) scheduledBits.push(`${reviewScheduled} fluent review${reviewScheduled === 1 ? '' : 's'}`);
    // Only show the "scheduled for later" footer for the fall-back (new) card; the pager already implies it for due items.
    const scheduledLine = kind === 'new' && scheduledBits.length ? `<p class="next-prev">+ ${scheduledBits.join(' and ')} scheduled for later</p>` : '';
    const curTime = escapeHtml(p.time || '');
    const curSolo = (p.solo || '').toUpperCase();
    const curStatus = (p.status || '').toLowerCase();
    const soloLabels = { '': '— not set', 'Y': 'Y · solved solo, no help', 'H': 'H · used a hint', 'N': 'N · read the solution' };
    const statusLabels = { '': '— not attempted', 'fluent': 'fluent · could re-solve cold', 'revisit': 'revisit · slow, hinted, or barely passed' };
    const soloOpts = Object.entries(soloLabels).map(([v, lbl]) => `<option value="${v}"${v === curSolo ? ' selected' : ''}>${lbl}</option>`).join('');
    const statusOpts = Object.entries(statusLabels).map(([v, lbl]) => `<option value="${v}"${v === curStatus ? ' selected' : ''}>${lbl}</option>`).join('');
    const hasNotes = !!(p.notes && p.notes.trim());
    const pagerHtml = navInfo ? `
      <div class="next-nav-row">
        <button type="button" class="next-nav-btn" onclick="navNextUp(-1)" title="Previous due item">‹</button>
        <span class="next-pager">${navInfo.idx + 1} of ${navInfo.total}</span>
        <button type="button" class="next-nav-btn" onclick="navNextUp(1)" title="Next due item">›</button>
      </div>` : '';
    return `
      <div class="next-card${cardClass}"${navInfo ? ` data-idx="${navInfo.idx}"` : ''}${isVisible ? '' : ' hidden'}>
        <div class="next-header-row">
          <h2 class="next-label">${label}</h2>
          ${pagerHtml}
        </div>
        <a class="next-title" href="${url}" target="_blank" rel="noopener">${escapeHtml(p.name)} →</a>
        ${p.isKey ? ' <span class="key">key</span>' : ''}
        <div class="next-meta">
          <span class="diff-${p.diff}">${escapeHtml(p.diff)}</span>
          <span class="dot">·</span>
          <span>${escapeHtml(p.pattern || '—')}</span>
          <span class="dot">·</span>
          <span>target ${target} min</span>
          ${dueLabel ? `<span class="dot">·</span><span class="due-label">${dueLabel}</span>` : ''}
          <span class="dot">·</span>
          <span class="muted-inline">Module ${m.id}: ${escapeHtml(m.title)}</span>
        </div>
        ${prevMeta ? `<p class="next-prev">${prevMeta}</p>` : ''}
        ${scheduledLine}
        <div class="next-actions">
          <button class="notes-btn${hasNotes ? ' has-notes' : ''}" onclick="toggleNotes(this)" title="${hasNotes ? 'View/edit notes' : 'Add notes'}">notes${hasNotes ? ' •' : ''}</button>
          <button class="edit-btn" onclick="toggleEdit(this)">edit</button>
        </div>
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
      </div>`;
  };

  // No scheduled items → fall back to the next unattempted problem, or the "all caught up" state.
  if (candidates.length === 0) {
    let firstNew = null, firstNewMod = null;
    for (const m of modules) {
      for (const p of m.problems) if (isNew(p)) { firstNew = p; firstNewMod = m; break; }
      if (firstNew) break;
    }
    if (!firstNew) {
      const parts = [];
      if (revisitScheduled) parts.push(`${revisitScheduled} revisit${revisitScheduled === 1 ? '' : 's'}`);
      if (reviewScheduled) parts.push(`${reviewScheduled} fluent review${reviewScheduled === 1 ? '' : 's'}`);
      const msg = parts.length
        ? `Nothing due today. ${parts.join(' and ')} scheduled for later.`
        : `Every problem is fluent and nothing is scheduled. Time for mocks.`;
      return `<div class="next-card done"><h2 class="next-label">All caught up</h2><p>${msg}</p></div>`;
    }
    return buildCard(firstNew, firstNewMod, 'new', null, true);
  }

  // Pre-render every candidate card; JS toggles which is visible — no page reload on nav.
  const safeInitial = Math.min(Math.max(0, nextIdx), candidates.length - 1);
  const cards = candidates.map(({ p, m, kind }, i) =>
    buildCard(p, m, kind, { idx: i, total: candidates.length }, i === safeInitial)
  ).join('');
  return `<div class="next-stack" data-current="${safeInitial}" data-count="${candidates.length}">${cards}</div>`;
})()}

${(() => {
  const today = todayStr();
  const scheduled = [];
  for (const m of modules) for (const p of m.problems) {
    if (p.status !== 'revisit' && p.status !== 'fluent') continue;
    let daysUntil;
    if (p.status === 'revisit' && !p.dueDate) {
      daysUntil = 0;  // revisit with no record → treated as due today
    } else if (p.dueDate) {
      daysUntil = daysBetween(today, p.dueDate);
    } else {
      continue;  // fluent with no due date → not on schedule
    }
    scheduled.push({ p, m, daysUntil });
  }
  if (scheduled.length === 0) return '';
  scheduled.sort((a, b) => a.daysUntil - b.daysUntil);

  const visibleItems = scheduled.filter(item => item.daysUntil <= 3);
  const hiddenCount = scheduled.length - visibleItems.length;

  const buckets = { 'Today': [], 'Next 3 days': [] };
  for (const item of visibleItems) {
    if (item.daysUntil <= 0) buckets['Today'].push(item);
    else buckets['Next 3 days'].push(item);
  }

  const renderBucket = (label, items, extraClass = '') => items.length === 0 ? '' : `
    <div class="sched-bucket${extraClass ? ' ' + extraClass : ''}">
      <h4>${label} <span class="sched-count">${items.length}</span></h4>
      <ul class="scheduled-list">
        ${items.map(({ p, m, daysUntil: d }) => {
          const when = d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d}d`;
          const kind = p.status === 'fluent' ? 'review' : 'revisit';
          return `<li>
            <span class="sched-when${d <= 0 ? ' due-now' : ''}">${when}</span>
            <a href="${leetcodeUrl(p.name)}" target="_blank" rel="noopener">${escapeHtml(p.name)}</a>${p.isKey ? ' <span class="key">key</span>' : ''}
            <span class="diff-${p.diff}">${p.diff}</span>
            <span class="sched-kind sched-kind-${kind}">${kind}</span>
            <span class="sched-mod">M${m.id}</span>
          </li>`;
        }).join('')}
      </ul>
    </div>`;

  return `
    <details class="scheduled-section" open>
      <summary class="sched-summary"><span class="sched-chevron">▸</span>Scheduled <span class="sched-total-count">${visibleItems.length}</span></summary>
      <div class="card scheduled-card">
        ${renderBucket('Today', buckets['Today'], 'sched-today')}
        ${renderBucket('Next 3 days', buckets['Next 3 days'])}
        ${hiddenCount ? `<p class="sched-later-note">+ ${hiddenCount} more scheduled beyond 3 days</p>` : ''}
      </div>
    </details>`;
})()}

${(() => {
  const today = todayStr();
  let streakSub;
  if (streak.current === 0) streakSub = 'log a problem to start';
  else if (streak.lastActive === today) streakSub = `best ${streak.best}`;
  else streakSub = `update today to keep it · best ${streak.best}`;
  const streakEmoji =
    streak.current === 0 ? '💔' :
    streak.current >= 30 ? '🚀🔥🔥' :
    streak.current >= 14 ? '🔥🔥🔥' :
    streak.current >= 7  ? '🔥🔥' :
    streak.current >= 3  ? '🔥' :
                           '✨';
  const streakClass = streak.current === 0 ? ' broken' : streak.current > 0 ? ' on-fire' : '';
  return `
    <h2>Summary</h2>
    <div class="row">
      <div class="tile streak${streakClass}"><h4>Streak <span class="streak-emoji">${streakEmoji}</span></h4><p class="big">${streak.current}<span class="streak-unit"> ${streak.current === 1 ? 'day' : 'days'}</span></p><p class="small">${streakSub}</p></div>
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

<h2>Boss Rush</h2>
<div id="boss-rush-root"></div>

<div class="theme-toggle" role="group" aria-label="Color theme">
  <button type="button" data-theme-set="auto">Auto</button>
  <button type="button" data-theme-set="light">Light</button>
  <button type="button" data-theme-set="dark">Dark</button>
</div>
<p class="ts">edits save to ${escapeHtml(PROGRESS_FILE)} · auto-refresh every 30s when idle</p>
</main>
<script>
window._fluentProblems = ${JSON.stringify(modules.flatMap(m => m.problems.filter(p => p.status === 'fluent').map(p => ({name: p.name, diff: p.diff, pattern: p.pattern || '—', module: m.id, moduleTitle: m.title, url: leetcodeUrl(p.name)})))).replace(/<\//g, '<\\/')};
function navNextUp(dir) {
  const stack = document.querySelector('.next-stack');
  if (!stack) return;
  const count = parseInt(stack.dataset.count, 10);
  if (!count) return;
  let cur = parseInt(stack.dataset.current, 10) || 0;
  cur = (cur + dir + count) % count;
  stack.dataset.current = cur;
  stack.querySelectorAll('.next-card').forEach(c => {
    c.hidden = parseInt(c.dataset.idx, 10) !== cur;
  });
  // Reflect in URL so saves keep the same card; no reload.
  try {
    const params = new URLSearchParams(location.search);
    if (cur === 0) params.delete('nextIdx'); else params.set('nextIdx', String(cur));
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  } catch (_) {}
}
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
(function bossRush() {
  var LS = 'bossRush_v2';
  var MAX_HP = 3;
  function load() {
    try { var s = localStorage.getItem(LS); if (s) return JSON.parse(s); } catch(e) {}
    return { active: false, gameOver: false, score: 0, highScore: 0, hp: MAX_HP, used: [], current: null };
  }
  function save(st) { try { localStorage.setItem(LS, JSON.stringify(st)); } catch(e) {} }
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pickNext(excludeNames) {
    var excl = {};
    excludeNames.forEach(function(n) { excl[n] = true; });
    var pool = (window._fluentProblems || []).filter(function(p) { return !excl[p.name]; });
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function heartsHtml(hp) {
    var h = '';
    for (var i = 0; i < MAX_HP; i++) {
      h += '<span class="br-heart ' + (i < hp ? 'full' : 'empty') + '">' + (i < hp ? '&#9829;' : '&#9825;') + '</span>';
    }
    return '<div class="br-hearts">' + h + '</div>';
  }
  function render() {
    var root = document.getElementById('boss-rush-root');
    if (!root) return;
    var st = load();
    var total = (window._fluentProblems || []).length;
    var hp = st.hp != null ? st.hp : MAX_HP;
    var html;
    if (!st.active && st.gameOver) {
      html = '<div class="boss-rush-card br-gameover">' +
        '<p class="boss-rush-label">Boss Rush &mdash; Game Over</p>' +
        heartsHtml(0) +
        '<p class="boss-rush-win-title" style="color:#f87171">&#128128; Out of lives!</p>' +
        '<p class="boss-rush-hs">Score: <span class="br-hs-val">' + st.score + '</span> &nbsp; High score: <span class="br-hs-val">' + st.highScore + '</span></p>' +
        '<div class="boss-rush-actions"><button class="br-btn br-btn-start" onclick="bossRushStart()">Try Again</button></div>' +
        '</div>';
    } else if (!st.active) {
      html = '<div class="boss-rush-card inactive">' +
        '<p class="boss-rush-label boss-rush-inactive-label">Boss Rush</p>' +
        '<p class="boss-rush-desc">Problems from your fluent list, assigned at random &mdash; no repeats until you reset. ' +
        'You have 3 lives. Recover 1 HP every 10 correct answers.</p>' +
        (st.highScore > 0 ? '<p class="boss-rush-hs">High score: <span class="br-hs-val">' + st.highScore + ' / ' + total + '</span></p>' : '') +
        '<div class="boss-rush-actions"><button class="br-btn br-btn-start" onclick="bossRushStart()">Start Boss Rush</button></div>' +
        '</div>';
    } else if (!st.current) {
      html = '<div class="boss-rush-card br-win">' +
        '<p class="boss-rush-label">Boss Rush</p>' +
        heartsHtml(hp) +
        '<p class="boss-rush-win-title">&#127942; Perfect run &mdash; all ' + total + ' cleared!</p>' +
        '<p class="boss-rush-hs">Score: <span class="br-hs-val">' + st.score + '</span> &nbsp; High score: <span class="br-hs-val">' + st.highScore + '</span></p>' +
        '<div class="boss-rush-actions"><button class="br-btn br-btn-reset" onclick="bossRushReset()">Reset</button></div>' +
        '</div>';
    } else {
      var p = st.current;
      var remaining = total - st.used.length - 1;
      var hpRecover = '';
      if (hp < MAX_HP) {
        var nextHpAt = Math.ceil((st.score + 1) / 10) * 10;
        hpRecover = '<span class="br-hp-recover">&hearts; +1 HP in ' + (nextHpAt - st.score) + ' more</span>';
      }
      html = '<div class="boss-rush-card">' +
        '<div class="boss-rush-header">' +
          '<p class="boss-rush-label">Boss Rush</p>' +
          '<div class="boss-rush-score-row">' +
            '<span class="boss-rush-score-num">' + st.score + '</span>' +
            '<span class="boss-rush-score-label">streak</span>' +
            '<span class="boss-rush-score-sep">&nbsp;&middot;&nbsp;</span>' +
            '<span class="boss-rush-hs">Best <span class="br-hs-val">' + st.highScore + '</span></span>' +
          '</div>' +
        '</div>' +
        '<div class="br-hp-row">' + heartsHtml(hp) + hpRecover + '</div>' +
        '<a class="boss-rush-title" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.name) + ' &rarr;</a>' +
        '<div class="boss-rush-meta">' +
          '<span class="diff-' + esc(p.diff) + '">' + esc(p.diff) + '</span>' +
          '<span class="dot">&middot;</span>' +
          '<span>' + esc(p.pattern) + '</span>' +
          '<span class="dot">&middot;</span>' +
          '<span>M' + p.module + ': ' + esc(p.moduleTitle) + '</span>' +
        '</div>' +
        '<p class="boss-rush-remaining">' + remaining + ' problem' + (remaining === 1 ? '' : 's') + ' remaining in pool</p>' +
        '<div class="boss-rush-actions">' +
          '<button class="br-btn br-btn-complete" onclick="bossRushComplete()">&#10003; Complete</button>' +
          '<button class="br-btn br-btn-fail" onclick="bossRushFail()">&#10007; Failed' + (hp === 1 ? ' (last life!)' : '') + '</button>' +
          '<button class="br-btn br-btn-reset" onclick="bossRushReset()">Reset</button>' +
        '</div>' +
        '</div>';
    }
    root.innerHTML = html;
  }
  window.bossRushStart = function() {
    var st = load();
    var next = pickNext([]);
    if (!next) { alert('No fluent problems found. Mark some problems as fluent first!'); return; }
    save({ active: true, gameOver: false, score: 0, highScore: st.highScore, hp: MAX_HP, used: [], current: next });
    render();
  };
  window.bossRushComplete = function() {
    var st = load();
    if (!st.current) return;
    var newUsed = st.used.concat([st.current.name]);
    var newScore = st.score + 1;
    var newHigh = Math.max(newScore, st.highScore);
    var hp = st.hp != null ? st.hp : MAX_HP;
    if (newScore % 10 === 0) hp = Math.min(hp + 1, MAX_HP);
    var next = pickNext(newUsed);
    save({ active: true, gameOver: false, score: newScore, highScore: newHigh, hp: hp, used: newUsed, current: next });
    render();
  };
  window.bossRushFail = function() {
    var st = load();
    var hp = (st.hp != null ? st.hp : MAX_HP) - 1;
    if (hp <= 0) {
      save({ active: false, gameOver: true, score: st.score, highScore: st.highScore, hp: 0, used: [], current: null });
    } else {
      // Current problem goes back into the pool (not added to used); skip it for the immediate next pick
      var next = pickNext(st.used.concat([st.current ? st.current.name : '']));
      if (!next) next = pickNext(st.used);
      save({ active: true, gameOver: false, score: st.score, highScore: st.highScore, hp: hp, used: st.used, current: next });
    }
    render();
  };
  window.bossRushReset = function() {
    var st = load();
    save({ active: false, gameOver: false, score: 0, highScore: st.highScore, hp: MAX_HP, used: [], current: null });
    render();
  };
  render();
})();

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
  if (req.url === '/favicon.svg' || req.url.startsWith('/favicon.svg?')) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(FAVICON_SVG);
  }
  if (req.url === '/favicon.png' || req.url === '/favicon.ico' || req.url.startsWith('/favicon.png?')) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
    return res.end(FAVICON_PNG);
  }
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
    const qs = req.url.split('?')[1] || '';
    const params = new URLSearchParams(qs);
    const nextIdx = Math.max(0, parseInt(params.get('nextIdx') || '0', 10) || 0);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderHtml(stats, modules, weakSpots, streak, nextIdx));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Error: ' + err.message);
  }
});

function recomputeAllDueDates() {
  let md;
  try { md = fs.readFileSync(PROGRESS_FILE, 'utf8'); } catch { return; }
  const { modules } = parseProgress(md);
  const isKeyMap = {};
  for (const m of modules) for (const p of m.problems) isKeyMap[p.name] = p.isKey;

  const attempts = loadAttempts();
  let changed = 0;
  for (const name in attempts) {
    const rec = attempts[name];
    if (!rec.status || !rec.lastDate) continue;
    const priorHistory = (rec.history || []).slice(0, -1);
    const dueDays = computeDueDays(rec.solo, rec.status, priorHistory, isKeyMap[name]);
    const newDue = dueDays != null ? addDays(rec.lastDate, dueDays) : null;
    if ((newDue || null) !== (rec.dueDate || null)) {
      rec.dueDate = newDue;
      changed++;
    }
  }
  if (changed > 0) {
    saveAttempts(attempts);
    console.log(`Recomputed due dates for ${changed} problem(s) with current schedule.`);
  }
}

server.listen(PORT, '127.0.0.1', () => {
  recomputeAllDueDates();
  console.log(`LeetCode dashboard → http://localhost:${PORT}`);
});

/* ── Constants ───────────────────────────────────────────────────────────────── */
const DAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
const STORAGE_KEY = 'programData';

let programData = null;
let currentWeekIdx = 0;

/* ── Init ────────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupUploadUI();

  // Restore from localStorage if available
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      programData = JSON.parse(saved);
      showApp();
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      showUpload();
    }
  } else {
    showUpload();
  }
});

/* ── Upload UI ───────────────────────────────────────────────────────────────── */
function setupUploadUI() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  document.getElementById('browse-btn').addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('click', (e) => {
    if (e.target.id !== 'browse-btn') fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  document.getElementById('change-btn').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    programData = null;
    showUpload();
  });
}

function showUpload() {
  document.getElementById('upload-screen').style.display = '';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('upload-screen').style.display = 'none';
  document.getElementById('app').style.display = '';
  document.getElementById('program-title').textContent = programData.title;
  renderWeek(programData.weeks.length - 1);
}

function showError(msg) {
  const el = document.getElementById('upload-error');
  el.textContent = msg;
  el.style.display = '';
}

/* ── File Handling ───────────────────────────────────────────────────────────── */
function handleFile(file) {
  document.getElementById('upload-error').style.display = 'none';

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const workbook = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      programData = parseWorkbook(workbook, file.name);

      if (!programData.weeks.length) {
        showError('No training weeks found. Make sure your sheets are named "week 1", "week 2", etc.');
        return;
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(programData));
      showApp();
    } catch (err) {
      showError('Could not parse this file: ' + err.message);
    }
  };
  reader.onerror = () => showError('Could not read the file.');
  reader.readAsArrayBuffer(file);
}

/* ── Workbook Parser ─────────────────────────────────────────────────────────── */
function parseWorkbook(workbook, filename) {
  const weeks = [];
  let title = filename.replace(/\.[^.]+$/, '');

  workbook.SheetNames.forEach((sheetName) => {
    const normalized = sheetName.trim().toLowerCase();
    if (!normalized.startsWith('week')) return;

    const m = normalized.match(/(\d+)/);
    if (!m) return;
    const weekNum = parseInt(m[1], 10);

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

    // Extract program title from first non-empty cell of first sheet
    if (weekNum === 1 || !weeks.length) {
      for (const row of rows) {
        const v = String(row[0] || '').trim();
        if (v && !v.toLowerCase().startsWith('week') && !DAYS.has(v)) {
          title = v;
          break;
        }
      }
    }

    const days = parseSheet(rows);
    if (days.length) weeks.push({ week: weekNum, days });
  });

  weeks.sort((a, b) => a.week - b.week);
  return { title, weeks };
}

/* ── Sheet Parser (mirrors parse.py logic) ───────────────────────────────────── */
function parseSheet(rows) {
  const days = [];
  let currentDay = null;
  let currentExercise = null;
  let awaitingWeights = false;

  for (const rawRow of rows) {
    const vals = rawRow.map(v => (v == null ? '' : String(v).trim()));
    if (!vals.some(v => v)) continue;

    const v0 = vals[0] || '';

    // ── DAY HEADER ────────────────────────────────────────────────────────────
    if (DAYS.has(v0)) {
      awaitingWeights = false;
      if (currentExercise && currentDay) {
        currentDay.exercises.push(currentExercise);
        currentExercise = null;
      }
      if (currentDay) days.push(currentDay);

      let dateStr = '';
      if (vals[1]) {
        const raw = String(vals[1]);
        // SheetJS with cellDates returns ISO strings like "2024-12-09T00:00:00.000Z"
        const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        if (isoMatch) dateStr = isoMatch[1];
      }

      currentDay = { day: v0, date: dateStr, exercises: [] };
      continue;
    }

    if (!currentDay) continue;

    // ── AWAITING WEIGHTS ──────────────────────────────────────────────────────
    if (awaitingWeights) {
      if (currentExercise && currentExercise.blocks.length) {
        currentExercise.blocks[currentExercise.blocks.length - 1].weight_vals = [...vals];
      }
      awaitingWeights = false;
      continue;
    }

    // ── NEW MAIN LIFT ─────────────────────────────────────────────────────────
    if (v0.toLowerCase().includes('max') && vals.slice(1).some(v => v.includes('%'))) {
      if (currentExercise) currentDay.exercises.push(currentExercise);
      currentExercise = {
        type: 'main',
        name: v0,
        blocks: [{ scheme_vals: [...vals], weight_vals: [] }]
      };
      awaitingWeights = true;
      continue;
    }

    // ── CONTINUATION SCHEME ───────────────────────────────────────────────────
    if (currentExercise && currentExercise.type === 'main') {
      if (v0.includes('%') || (!v0 && vals.slice(1).some(v => v.includes('%')))) {
        currentExercise.blocks.push({ scheme_vals: [...vals], weight_vals: [] });
        awaitingWeights = true;
        continue;
      }
    }

    // ── END CURRENT LIFT ──────────────────────────────────────────────────────
    if (currentExercise) {
      currentDay.exercises.push(currentExercise);
      currentExercise = null;
    }

    // ── RECOVERY NOTE (nothing in cols 1+) ────────────────────────────────────
    if (!vals.slice(1).some(v => v)) {
      if (v0) currentDay.exercises.push({ type: 'note', text: v0 });
      continue;
    }

    // ── ACCESSORY ─────────────────────────────────────────────────────────────
    if (v0 && vals[1]) {
      currentDay.exercises.push({
        type: 'accessory',
        name: v0,
        prescription: vals.slice(1).filter(v => v)
      });
      continue;
    }

    if (v0) currentDay.exercises.push({ type: 'note', text: v0 });
  }

  // Flush
  if (currentExercise && currentDay) currentDay.exercises.push(currentExercise);
  if (currentDay) days.push(currentDay);

  return days;
}

/* ── Week Render ─────────────────────────────────────────────────────────────── */
function renderWeek(weekIdx) {
  currentWeekIdx = weekIdx;
  const week = programData.weeks[weekIdx];
  const total = programData.weeks.length;

  document.getElementById('week-label').textContent = `Week ${week.week} / ${total}`;
  document.getElementById('prev-week').disabled = weekIdx === 0;
  document.getElementById('next-week').disabled = weekIdx === total - 1;

  const tabsEl = document.getElementById('day-tabs');
  tabsEl.innerHTML = '';
  week.days.forEach((day, i) => {
    const isRest = isRestDay(day);
    const btn = document.createElement('button');
    btn.className = 'day-tab' + (i === 0 ? ' active' : '') + (isRest ? ' rest' : '');
    btn.textContent = day.day.slice(0, 3);
    btn.title = day.day + (day.date ? ` · ${formatDate(day.date)}` : '');
    btn.addEventListener('click', () => {
      document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      renderDay(weekIdx, i);
    });
    tabsEl.appendChild(btn);
  });

  renderDay(weekIdx, 0);
}

document.getElementById('prev-week').addEventListener('click', () => {
  if (currentWeekIdx > 0) renderWeek(currentWeekIdx - 1);
});
document.getElementById('next-week').addEventListener('click', () => {
  if (currentWeekIdx < programData.weeks.length - 1) renderWeek(currentWeekIdx + 1);
});

/* ── Day Render ──────────────────────────────────────────────────────────────── */
function renderDay(weekIdx, dayIdx) {
  const day = programData.weeks[weekIdx].days[dayIdx];
  const container = document.getElementById('exercises');
  container.innerHTML = '';

  if (day.date) {
    const dateEl = document.createElement('div');
    dateEl.className = 'day-date';
    dateEl.textContent = formatDate(day.date);
    container.appendChild(dateEl);
  }

  if (!day.exercises || day.exercises.length === 0) {
    container.innerHTML += '<div class="empty-state">No exercises listed.</div>';
    return;
  }

  day.exercises.forEach(ex => {
    let el;
    if (ex.type === 'main') el = buildMainCard(ex);
    else if (ex.type === 'accessory') el = buildAccessoryCard(ex);
    else el = buildNoteCard(ex);
    if (el) container.appendChild(el);
  });
}

/* ── Main Lift Card ──────────────────────────────────────────────────────────── */
function buildMainCard(ex) {
  const { title, maxStr } = parseExerciseName(ex.name);
  const card = div('card card-main');

  const header = div('card-header');
  header.appendChild(span('lift-name', title));
  if (maxStr) header.appendChild(span('lift-max', maxStr));
  card.appendChild(header);

  const body = div('card-body');

  ex.blocks.forEach((block, blockIdx) => {
    const isFirst = blockIdx === 0;
    const { warmup, sets, notes } = parseBlock(block.scheme_vals, block.weight_vals, isFirst);
    const setsBlock = div('sets-block');

    if (!isFirst) setsBlock.appendChild(div('block-label', 'Descending Block'));

    if (isFirst && warmup) {
      const wu = div('warmup-row');
      wu.appendChild(span('warmup-label', 'Warmup'));
      wu.appendChild(document.createTextNode(warmup));
      setsBlock.appendChild(wu);
    }

    // Column headers
    if (sets.length) {
      const headerRow = div('set-row set-row-header');
      headerRow.appendChild(span('set-col-header', '%'));
      headerRow.appendChild(span('set-col-header', 'weight'));
      setsBlock.appendChild(headerRow);
    }

    sets.forEach(s => {
      const row = div('set-row');
      row.appendChild(span('set-scheme', formatScheme(s.scheme)));
      row.appendChild(span('set-weight', s.weight || '—'));
      setsBlock.appendChild(row);
    });

    if (notes.length) {
      const notesRow = div('notes-row');
      notes.forEach(n => notesRow.appendChild(span('note-tag', n)));
      setsBlock.appendChild(notesRow);
    }

    body.appendChild(setsBlock);
  });

  card.appendChild(body);
  return card;
}

/* ── Accessory Card ──────────────────────────────────────────────────────────── */
function buildAccessoryCard(ex) {
  const card = div('card card-accessory');
  card.appendChild(span('accessory-name', ex.name));

  if (ex.prescription && ex.prescription.length) {
    const prescrip = div('accessory-prescription');
    ex.prescription.forEach((item, i) => {
      if (i > 0) prescrip.appendChild(span('prescrip-sep', '·'));
      prescrip.appendChild(span(i === 0 ? 'prescrip-primary' : 'prescrip-note', item));
    });
    card.appendChild(prescrip);
  }

  return card;
}

/* ── Note Card ───────────────────────────────────────────────────────────────── */
function buildNoteCard(ex) {
  const card = div('card card-note');
  card.textContent = ex.text || '';
  return card;
}

/* ── Utilities ───────────────────────────────────────────────────────────────── */
function parseBlock(schemeVals, weightVals, isFirst) {
  const sets = [];
  const notes = [];
  const startIdx = isFirst ? 1 : 0;
  const warmup = isFirst ? (weightVals[0] || '') : '';

  for (let i = startIdx; i < schemeVals.length; i++) {
    const sv = (schemeVals[i] || '').trim();
    const wv = (weightVals[i] || '').trim();
    if (!sv) continue;

    if (sv.includes('%')) {
      sets.push({ scheme: sv, weight: wv });
    } else {
      if (!notes.includes(sv)) notes.push(sv);
      if (wv && !notes.includes(wv) && !looksLikeWeight(wv)) notes.push(wv);
    }
  }

  return { warmup, sets, notes };
}

function formatScheme(s) {
  // "70%x3x2 belt" → "70 × 3 × 2 belt"
  // "80%x2-3x5 belt" → "80 × 2-3 × 5 belt"
  const m = s.match(/^([\d.\-]+)%x(.+)$/);
  if (!m) return s;
  const pct = m[1];
  const rest = m[2].replace(/x(?=[\d\-])/g, ' × ');
  return pct + ' × ' + rest;
}

function looksLikeWeight(s) {
  return /^[\d\-./\s,xkgKGlb%]+$/.test(s.trim());
}

function parseExerciseName(name) {
  const m = name.match(/^(.*?)\s*-\s*(\d[\d\-.]+)\s+max\s*$/i);
  if (m) return { title: m[1].trim(), maxStr: m[2] + ' max' };
  return { title: name, maxStr: '' };
}

function isRestDay(day) {
  const types = (day.exercises || []).map(e => e.type);
  return !types.includes('main') && !types.includes('accessory');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, mo, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const wdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return `${wdays[dt.getDay()]}, ${months[dt.getMonth()]} ${Number(d)}, ${y}`;
}

function div(cls, text) {
  const el = document.createElement('div');
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function span(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

'use strict';

let loadedAlerts = [];

// ── CSV Parsing ──────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(rawText) {
  // Strip UTF-8 BOM if present
  const text = rawText.charCodeAt(0) === 0xFEFF ? rawText.slice(1) : rawText;
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (vals[idx] ?? '').trim();
    });
    if (obj['Alert ID']) rows.push(obj);
  }
  return rows;
}

// ── Filtering ────────────────────────────────────────────────────────────────
//
// Rules:
//   • Exclude rows where State = INVALID
//   • Always include Alert Type = WITHDRAWAL (no % threshold applies)
//   • Include Alert Type = TRANSFER only when "% of Transfer" >= 80

function filterAlerts(alerts) {
  return alerts.filter(row => {
    const state = (row['State'] || '').trim().toUpperCase();
    if (state === 'INVALID') return false;

    const type = (row['Alert Type'] || '').trim().toUpperCase();
    if (type === 'WITHDRAWAL') return true;
    if (type === 'TRANSFER') {
      const pct = parseFloat(row['% of Transfer'] || '0');
      return pct >= 80;
    }
    return false;
  });
}

// ── Grouping ─────────────────────────────────────────────────────────────────
//
// Each unique combination of (Alert Type, Direction, risk entity) forms one
// paragraph.  Risk entity = Service Name when present, otherwise Category.

function groupAlerts(alerts) {
  const map = new Map();
  for (const row of alerts) {
    const type      = (row['Alert Type']   || '').trim().toUpperCase();
    const dir       = (row['Direction']    || '').trim().toUpperCase();
    const category  = (row['Category']     || '').trim();
    const service   = (row['Service Name'] || '').trim();
    const riskEntity = service || category;
    const key = `${type}\x00${dir}\x00${riskEntity}`;
    if (!map.has(key)) {
      map.set(key, { type, dir, category, service, riskEntity, rows: [] });
    }
    map.get(key).rows.push(row);
  }
  return [...map.values()];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(str) {
  if (!str) return 'unknown date';
  // Normalise "YYYY-MM-DD HH:MM:SS" → ISO 8601 UTC
  const d = new Date(str.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return str;
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  });
}

function fmtAmount(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

// ── Paragraph builder ────────────────────────────────────────────────────────

function buildParagraph(group) {
  const { type, dir, category, riskEntity, rows } = group;

  const sorted = [...rows].sort(
    (a, b) => new Date(a['Transfer At']) - new Date(b['Transfer At'])
  );

  const firstDate = fmtDate(sorted[0]['Transfer At']);
  const lastDate  = fmtDate(sorted[sorted.length - 1]['Transfer At']);
  const datePart  = firstDate === lastDate
    ? `On ${firstDate}`
    : `From ${firstDate} to ${lastDate}`;

  const total  = rows.reduce((s, r) => s + parseFloat(r['Alert Amount'] || '0'), 0);
  const count  = rows.length;
  const sym    = rows[0]['Symbol']  || '';
  const net    = rows[0]['Network'] || '';
  const amtStr = `${fmtAmount(total)} ${sym}${net ? ` (${net})` : ''}`;

  // ── WITHDRAWAL (direct, no on-chain addresses captured) ─────────────────
  if (type === 'WITHDRAWAL') {
    const noun = count === 1 ? 'withdrawal attempt' : 'withdrawal attempts';
    return [
      `Withdrawal Attempts`,
      ``,
      `${datePart}, the user made ${count} ${noun} directly to ${riskEntity} (${category}),`,
      `for a total of ${amtStr} USD (at the time of the transfer).`
    ].join('\n');
  }

  // ── TRANSFER – RECEIVED (indirect inflow) ───────────────────────────────
  if (dir === 'RECEIVED') {
    const noun = count === 1 ? 'deposit' : 'deposits';

    // Output Address = user's deposit address (destination of the tx)
    const internalAddrs = unique(rows.map(r => r['Output Address']));
    const internalAddr  = internalAddrs.length ? internalAddrs.join(', ') : 'N/A';

    // Tx Hashes are the on-chain references linking back to the risky entity
    const txHashes = unique(rows.map(r => r['Tx Hash']));
    const extList  = txHashes.length ? txHashes.join('\n') : 'N/A';

    return [
      `Deposits`,
      ``,
      `${datePart}, the user made ${count} ${noun} directly from ${riskEntity} (${category}),`,
      `for a total of ${amtStr} USD (at the time of the transfer) to his account`,
      `receiving address: ${internalAddr}, via the following transaction(s):`,
      ``,
      extList
    ].join('\n');
  }

  // ── TRANSFER – SENT (indirect outflow) ──────────────────────────────────
  {
    const noun = count === 1 ? 'outgoing transfer' : 'outgoing transfers';

    // Output Address = destination of the tx (external / risky address)
    const extAddrs = unique(rows.map(r => r['Output Address']));
    const extList  = extAddrs.length ? extAddrs.join('\n') : 'N/A';

    // The user's own sending address is the input side of the tx; not captured
    // in this export, so we surface the destination addresses instead.
    return [
      `Outgoing Transfers`,
      ``,
      `${datePart}, the user made ${count} ${noun} connected to ${riskEntity} (${category}),`,
      `for a total of ${amtStr} USD (at the time of the transfer) from his account`,
      `sending address: N/A, via the following external address(es):`,
      ``,
      extList
    ].join('\n');
  }
}

// ── Summary entry point ───────────────────────────────────────────────────────

function buildSummary(allAlerts) {
  const filtered = filterAlerts(allAlerts);

  if (!filtered.length) {
    return [
      'No qualifying alerts found.',
      '',
      'Filter applied:',
      '  • Alert Type = WITHDRAWAL  →  always included',
      '  • Alert Type = TRANSFER    →  included only when % of Transfer ≥ 80',
      '  • Rows with State = INVALID are excluded'
    ].join('\n');
  }

  const groups = groupAlerts(filtered);

  // Sort: WITHDRAWAL first, then RECEIVED deposits, then SENT outflows
  const order = g => {
    if (g.type === 'WITHDRAWAL') return 0;
    if (g.dir === 'RECEIVED')    return 1;
    return 2;
  };
  groups.sort((a, b) => order(a) - order(b));

  const divider = '\n\n' + '─'.repeat(60) + '\n\n';
  return groups.map(buildParagraph).join(divider);
}

// ── UI wiring ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const dropZone   = document.getElementById('dropZone');
  const fileInput  = document.getElementById('fileInput');
  const fileLabel  = document.getElementById('fileLabel');
  const genBtn     = document.getElementById('genBtn');
  const outputWrap = document.getElementById('outputWrap');
  const outputPre  = document.getElementById('outputPre');
  const copyBtn    = document.getElementById('copyBtn');
  const errBox     = document.getElementById('errBox');

  function setError(msg) {
    errBox.textContent = msg;
    errBox.hidden = !msg;
  }

  function loadFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a .csv file.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = e => {
      try {
        loadedAlerts = parseCSV(e.target.result);
        if (!loadedAlerts.length) {
          setError('The CSV file appears to be empty or has no data rows.');
          return;
        }
        fileLabel.textContent = `${file.name}  —  ${loadedAlerts.length} alert${loadedAlerts.length !== 1 ? 's' : ''} loaded`;
        dropZone.classList.add('loaded');
        genBtn.disabled  = false;
        outputWrap.hidden = true;
      } catch (err) {
        setError(`Parse error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  // Drag-and-drop
  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('over'); });
  dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('over');
    loadFile(e.dataTransfer.files[0]);
  });
  dropZone.addEventListener('click', e => {
    if (!['LABEL', 'INPUT'].includes(e.target.tagName)) fileInput.click();
  });
  fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));

  // Generate
  genBtn.addEventListener('click', () => {
    setError('');
    try {
      const text = buildSummary(loadedAlerts);
      outputPre.textContent = text;
      outputWrap.hidden = false;
    } catch (err) {
      setError(`Generation error: ${err.message}`);
    }
  });

  // Copy to clipboard
  copyBtn.addEventListener('click', () => {
    const text = outputPre.textContent;
    navigator.clipboard.writeText(text)
      .then(() => flash(copyBtn, '✓ Copied!', 'copied'))
      .catch(() => {
        // Fallback for environments without clipboard API
        const sel   = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(outputPre);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        flash(copyBtn, '✓ Copied!', 'copied');
      });
  });

  function flash(el, label, cls) {
    const orig = el.textContent;
    el.textContent = label;
    el.classList.add(cls);
    setTimeout(() => { el.textContent = orig; el.classList.remove(cls); }, 2000);
  }
});

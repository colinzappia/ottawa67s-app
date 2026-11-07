const API = '';

let games = [];
let editingId = null;
let lastParsedTeams = {};
let lastParsedSummary = { shots: [], ppFrac: [], ppFow: [] };
let lastParsedGoals = [];

async function api(path, opts) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) throw new Error('Request failed: ' + path);
  return res.status === 204 ? null : res.json();
}

/* ===================== TABS ===================== */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'players') { populatePlayerGameSelect(); renderSeasonPlayerTotals(); }
    if (btn.dataset.tab === 'goals') { populateGoalsGameSelect(); renderSeasonGoalsBreakdown(); }
    if (btn.dataset.tab === 'trends') { renderTrendsTab(); }
  });
});

/* ===================== LINEUP PDF UPLOAD ===================== */
function wireLineupPdfUpload() {
  const input = document.getElementById('combinedPhotoInput');
  input.addEventListener('change', function () {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const dataUrl = e.target.result;
      if (!dataUrl.startsWith('data:application/pdf')) {
        clearLineupsDebug();
        document.getElementById('lineupsStatus').textContent = 'Only the league lineup PDF can be read — choose a PDF file.';
        return;
      }
      // The league lineup PDF is only read for the names and numbers; the file itself isn't saved or shown on the board.
      runLineupsRequest('/api/parse-lineups', { dataurl: dataUrl });
    };
    reader.readAsDataURL(file);
  });
}
wireLineupPdfUpload();

/* ===================== GAME LINEUPS (league PDF) ===================== */
function lineupPlayerText(p) { return p ? '#' + p.number + ' ' + p.name : null; }

// Writes one team's lines, D pairs and goalies into its panel; returns notes about anything the board has no slot for.
function fillTeamPanelFromLineup(panel, team) {
  const notes = [];
  const setSlot = (el, player, placeholder) => { if (el) el.textContent = player ? lineupPlayerText(player) : placeholder; };
  panel.querySelectorAll(':scope > .line-row').forEach((row, i) => {
    const s = row.querySelectorAll('span[contenteditable]');
    const line = team.forwards[i] || {};
    setSlot(s[0], line.lw, 'LW'); setSlot(s[1], line.c, 'C'); setSlot(s[2], line.rw, 'RW');
  });
  panel.querySelectorAll('.dpairs .line-row').forEach((row, i) => {
    const s = row.querySelectorAll('span[contenteditable]');
    const pair = team.defense[i] || {};
    setSlot(s[0], pair.ld, 'LD'); setSlot(s[1], pair.rd, 'RD');
  });
  const g = panel.querySelectorAll('.goalies .line-row');
  if (g[0]) setSlot(g[0].querySelector('span[contenteditable]'), team.goalies.starter, 'Starter');
  if (g[1]) setSlot(g[1].querySelector('span[contenteditable]'), team.goalies.backup, 'Backup');
  const f5 = team.forwards[4];
  if (f5 && (f5.lw || f5.c || f5.rw)) notes.push('a 5th forward line');
  const d4 = team.defense[3];
  if (d4 && (d4.ld || d4.rd)) notes.push('a 4th defense pair');
  return notes;
}

/* ===================== OPPONENT NAME ===================== */
// The opponent's lineup panel is headed with the opponent's name, kept in step with the Opponent box at the top of the
// board however that box gets filled (typed, the lineup PDF, or the media kit).
const OPPONENT_NAME_PLACEHOLDER = 'Opponent Team Name';
function syncOpponentHeader() {
  const name = document.getElementById('boardOpponentName').textContent.trim();
  const oppHeader = document.querySelector('.team-panel.away .team-header span[contenteditable]');
  if (oppHeader) oppHeader.textContent = (name && name !== OPPONENT_NAME_PLACEHOLDER ? name : 'Opponent').toUpperCase();
}
// The opponent's name is the page's to fill while the box is empty, still shows its starting text, or still holds a
// name the page filled in itself (so the next game's lineup can replace it). Once you type in the box it's yours and
// nothing overwrites it.
function fillOpponentName(text) {
  const el = document.getElementById('boardOpponentName');
  const current = el.textContent.trim();
  if (!current || current === OPPONENT_NAME_PLACEHOLDER || el.dataset.auto === '1') {
    el.textContent = text;
    el.dataset.auto = '1';
    syncOpponentHeader();
    return true;
  }
  return false;
}
document.getElementById('boardOpponentName').addEventListener('input', () => {
  document.getElementById('boardOpponentName').dataset.auto = '';
  syncOpponentHeader();
});

function fillBoardFromLineups(data) {
  const ott = data.teams.find(t => t.isOttawa);
  const opp = data.teams.find(t => !t.isOttawa);
  if (!ott || !opp) return { error: "Read the file, but couldn't tell which team is Ottawa." };
  const notes = [];
  fillTeamPanelFromLineup(document.querySelector('.team-panel.away'), opp).forEach(n => notes.push(opp.name + ' has ' + n + ' that the board has no slot for'));
  fillTeamPanelFromLineup(document.querySelector('.team-panel.home'), ott).forEach(n => notes.push(ott.name + ' has ' + n + ' that the board has no slot for'));

  // The opponent's name comes from the PDF only when you haven't typed one yourself.
  const nameReplaced = fillOpponentName(opp.name);
  const typedName = document.getElementById('boardOpponentName').textContent.trim();
  const keptName = (!nameReplaced && typedName.toLowerCase() !== opp.name.toLowerCase()) ? typedName : null;

  if (data.game && data.game.date) {
    const [y, m, d] = data.game.date.split('-').map(Number);
    document.getElementById('boardDate').textContent = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (data.game && data.game.gameType) document.getElementById('boardGameType').value = data.game.gameType;

  const list = arr => arr.map(p => '#' + p.number + ' ' + p.name).join(', ');
  document.getElementById('boardScratchesOpp').textContent = opp.scratches.length ? list(opp.scratches) : 'None';
  document.getElementById('boardScratchesOtt').textContent = ott.scratches.length ? list(ott.scratches) : 'None';
  if (data.officials && data.officials.referees.length) document.getElementById('boardReferees').textContent = list(data.officials.referees);
  if (data.officials && data.officials.linesmen.length) document.getElementById('boardLinesmen').textContent = list(data.officials.linesmen);
  return { opp, ott, notes, keptName };
}

function clearLineupsDebug() {
  const box = document.getElementById('lineupsDebug'); if (box) box.remove();
  const note = document.getElementById('lineupsDebugNote'); if (note) note.remove();
}
function showLineupsDebug(statusEl, text) {
  clearLineupsDebug();
  if (!text) return;
  const box = document.createElement('textarea');
  box.id = 'lineupsDebug';
  box.readOnly = true;
  box.style.cssText = 'width:100%;height:180px;font-family:monospace;font-size:10px;margin-top:6px;';
  box.value = text;
  statusEl.parentNode.appendChild(box);
  const note = document.createElement('div');
  note.id = 'lineupsDebugNote';
  note.className = 'hint';
  note.textContent = "Copy the text above and send it back so the reader can be fixed to match this PDF's actual layout.";
  statusEl.parentNode.appendChild(note);
}

async function runLineupsRequest(path, payload) {
  const statusEl = document.getElementById('lineupsStatus');
  clearLineupsDebug();
  statusEl.textContent = 'Reading the lineup PDF…';
  let result;
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    result = await res.json();
  } catch (err) {
    statusEl.textContent = 'Could not reach the server to read that file.';
    return;
  }
  if (result.error) { statusEl.textContent = result.error; showLineupsDebug(statusEl, result.debugExcerpt); return; }
  let filled;
  try { filled = fillBoardFromLineups(result); }
  catch (err) { statusEl.textContent = 'Read the file but could not place it on the board — please try again.'; return; }
  if (filled.error) { statusEl.textContent = filled.error; return; }
  statusEl.textContent = 'Filled in the lineups for ' + filled.opp.name + ' and ' + filled.ott.name +
    ', plus scratches, officials and the date.' + (filled.keptName ? ' Kept the opponent name you typed (' + filled.keptName + ').' : '') + (filled.notes.length ? ' Note: ' + filled.notes.join('; ') + '.' : '');
}

document.getElementById('lineupsFetchBtn').addEventListener('click', () => {
  const statusEl = document.getElementById('lineupsStatus');
  let url = document.getElementById('lineupsUrl').value.trim();
  if (!url) { statusEl.textContent = 'Paste the lineup PDF link first.'; return; }
  const wrapper = url.match(/^chrome-extension:\/\/[^/]+\/(https?:\/\/.+)$/i);   // the browser's PDF viewer wraps the real link
  if (wrapper) url = wrapper[1];
  runLineupsRequest('/api/fetch-lineups', { url });
});

// "Windsor" matches "Windsor Spitfires"; accents, dots and capitals don't matter ("Sault Ste Marie" = "Sault Ste. Marie").
const teamNameKey = n => (n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function sameTeamName(a, b) {
  const x = teamNameKey(a), y = teamNameKey(b);
  if (x.length < 3 || y.length < 3) return false;
  return x === y || x.includes(y) || y.includes(x);
}
function findSpecialtyTeamRow(rows, typedName) {
  const typed = (typedName || '').trim().toLowerCase();
  if (!typed) return null;
  return rows.find(r => r.team.toLowerCase().includes(typed) || typed.includes(r.team.toLowerCase().split(' ')[0]));
}
function formatPP(row) { return `GP:${row.gp} ADV:${row.adv} GF:${row.gf} PP%:${row.ppPct.toFixed(1)} SHGA:${row.shga}`; }
function formatPK(row) { return `GP:${row.gp} TSH:${row.tsh} PPGA:${row.ppga} PK%:${row.pkPct.toFixed(1)} SHGF:${row.shgf}`; }

// The PP/PK half of the media-kit button: returns the message to show.
async function fillSpecialTeamsFromKit(url) {
  const statusEl = document.getElementById('specialtyTeamsStatus');
  let result;
  try {
    const res = await fetch('/api/fetch-specialty-teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
    });
    result = await res.json();
  } catch (err) {
    return 'Could not reach the server to fetch that PDF.';
  }
  try {
    if (result.error) {
      if (result.debugExcerpt) {
        const box = document.createElement('textarea');
        box.id = 'specialtyTeamsDebug';
        box.readOnly = true;
        box.style.cssText = 'width:100%;height:160px;font-family:monospace;font-size:10px;margin-top:6px;';
        box.value = result.debugExcerpt;
        statusEl.parentNode.appendChild(box);
        const note = document.createElement('div');
        note.id = 'specialtyTeamsDebugNote';
        note.className = 'hint';
        note.textContent = 'Copy the text above and send it back so the parser can be fixed to match this PDF\'s actual layout.';
        statusEl.parentNode.appendChild(note);
      }
      return result.error;
    }
    const opponentTyped = document.getElementById('boardOpponentName').textContent;
    const oppPP = findSpecialtyTeamRow(result.pp, opponentTyped);
    const oppPK = findSpecialtyTeamRow(result.pk, opponentTyped);
    const ottPP = result.pp.find(r => /67/.test(r.team));
    const ottPK = result.pk.find(r => /67/.test(r.team));
    const filled = [];
    if (oppPP) { document.getElementById('awayPP').textContent = formatPP(oppPP); document.getElementById('awayPPRank').textContent = '#' + oppPP.rank; filled.push('Opponent PP'); }
    if (oppPK) { document.getElementById('awayPK').textContent = formatPK(oppPK); document.getElementById('awayPKRank').textContent = '#' + oppPK.rank; filled.push('Opponent PK'); }
    if (ottPP) { document.getElementById('homePP').textContent = formatPP(ottPP); document.getElementById('homePPRank').textContent = '#' + ottPP.rank; filled.push("Ottawa PP"); }
    if (ottPK) { document.getElementById('homePK').textContent = formatPK(ottPK); document.getElementById('homePKRank').textContent = '#' + ottPK.rank; filled.push("Ottawa PK"); }
    if (filled.length === 0) return 'Found the Specialty Team Records section, but couldn\'t match the opponent name — check the Opponent field above and try again.';
    return 'Filled in: ' + filled.join(', ') + (oppPP || oppPK ? '' : ' (opponent not matched — check the Opponent name field)') + '.';
  } catch (err) {
    return 'Got a response but could not apply it — please try again.';
  }
}

/* ===================== GOALIE RECORDS (from the media kit) ===================== */
// SV% the way hockey prints it (.898); the kit gives 0.898
function kitSvText(sv) {
  const v = parseFloat(sv);
  if (!Number.isFinite(v)) return '—';
  const t = Math.min(1, v).toFixed(3);
  return t.startsWith('0') ? t.slice(1) : t;
}
// "1-0-1-0 / 2.95 / .898" (W-L-OTL-SL, GAA, SV%). A goalie with no games has no GAA or SV% to quote.
function goalieRecordText(g) {
  const rec = `${g.w}-${g.l}-${g.otl}-${g.sl}`;
  return g.gp > 0 ? `${rec} / ${Number(g.gaa).toFixed(2)} / ${kitSvText(g.svPct)}` : `${rec} / — / —`;
}
const goalieNamePieces = name => (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .split(/[\s,]+/).map(t => t.replace(/[^a-z]/g, '')).filter(Boolean);
// Same goalie? Order, accents and hyphens don't matter, and a name that wrapped across lines in the PDF still counts.
function sameGoalieName(a, b) {
  const pa = goalieNamePieces(a), pb = goalieNamePieces(b);
  if (!pa.length || !pb.length) return false;
  const inside = (pieces, joined) => { const big = pieces.filter(p => p.length >= 3); return big.length > 0 && big.every(p => joined.includes(p)); };
  return inside(pa, pb.join('')) || inside(pb, pa.join(''));
}
// The two goalie rows of a team panel: "#32 Jaeden Nelson" in the first box, the record in the second
function boardGoalieSlots(panel) {
  return [...panel.querySelectorAll('.goalies .line-row')].map(row => {
    const spans = row.querySelectorAll('span[contenteditable]');
    const text = ((spans[0] && spans[0].textContent) || '').trim();
    const m = text.match(/^#\s*(\d+)\s*(.*)$/);
    return { nameEl: spans[0], recEl: spans[1], text, number: m ? parseInt(m[1], 10) : null, name: m ? m[2].trim() : text, placeholder: /^(starter|backup)?$/i.test(text) };
  }).filter(s => s.nameEl && s.recEl);
}
// Which of the kit's goalie tables belongs to this side of the board (null if the tables carry no team names)
function pickKitTable(teams, isOttawa, opponentTyped) {
  if (!teams.some(t => t.team)) return null;
  const isOtt = t => /ottawa|67/i.test(t.team || '');
  if (isOttawa) return teams.find(isOtt) || null;
  const typed = (opponentTyped || '').trim().toLowerCase();
  const byName = typed && teams.find(t => !isOtt(t) && t.team && (t.team.toLowerCase().includes(typed) || typed.includes(t.team.toLowerCase().split(' ')[0])));
  return byName || teams.find(t => !isOtt(t)) || null;
}
// By jersey number first (within the right team's table), but only when the name agrees, so a mix-up between
// the two teams' tables can never put one goalie's numbers on another goalie.
function findKitGoalie(pool, slot) {
  if (slot.number !== null) {
    const hit = pool.filter(g => Number(g.number) === slot.number).find(g => !g.name || !slot.name || sameGoalieName(g.name, slot.name));
    if (hit) return hit;
  }
  return slot.name ? (pool.find(g => sameGoalieName(g.name, slot.name)) || null) : null;
}
function fillGoalieRecords(data, opponentTyped) {
  const filled = [], missing = [], unnamed = []; let named = 0;
  [['.team-panel.home', true], ['.team-panel.away', false]].forEach(([sel, isOttawa]) => {
    const table = pickKitTable(data.teams, isOttawa, opponentTyped);
    const pool = table ? table.goalies : data.teams.flatMap(t => t.goalies);
    boardGoalieSlots(document.querySelector(sel)).forEach(slot => {
      if (slot.placeholder) {                             // no goalie named on the board yet
        unnamed.push((isOttawa ? "Ottawa's " : "the opponent's ") + (slot.text ? slot.text.toLowerCase() : 'goalie'));
        return;
      }
      named++;
      const hit = findKitGoalie(pool, slot);
      if (hit) { slot.recEl.textContent = goalieRecordText(hit); filled.push(slot.text); } else missing.push(slot.text);
    });
  });
  return { filled, missing, unnamed, named };
}
function clearGoalieDebug() {
  const b = document.getElementById('goalieRecordsDebug'); if (b) b.remove();
  const n = document.getElementById('goalieRecordsDebugNote'); if (n) n.remove();
}
// The goalie half of the media-kit button: returns the message to show.
async function fillGoalieRecordsFromKit(url) {
  const statusEl = document.getElementById('specialtyTeamsStatus');
  let res, data;
  try {
    res = await fetch('/api/fetch-goalie-records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  } catch (err) { return 'Goalie records: could not reach the server.'; }
  if (res.status === 404) return "Goalie records: the server doesn't have the new goalie file yet (mediakit-goalies.js) — see the update notes.";
  try { data = await res.json(); } catch (err) { return 'Goalie records: the server sent back something unexpected.'; }
  if (data.error) {
    if (data.debugExcerpt) {
      const box = document.createElement('textarea');
      box.id = 'goalieRecordsDebug';
      box.readOnly = true;
      box.style.cssText = 'width:100%;height:160px;font-family:monospace;font-size:10px;margin-top:6px;';
      box.value = data.debugExcerpt;
      statusEl.parentNode.appendChild(box);
      const note = document.createElement('div');
      note.id = 'goalieRecordsDebugNote';
      note.className = 'hint';
      note.textContent = "Copy the goalie text above and send it back so the reader can be fixed to match this PDF's actual layout.";
      statusEl.parentNode.appendChild(note);
    }
    return 'Goalie records: ' + data.error;
  }
  let out;
  try { out = fillGoalieRecords(data, document.getElementById('boardOpponentName').textContent); }
  catch (err) { return 'Goalie records: got the data but could not place it on the board.'; }
  if (out.named === 0) return 'Goalie records: load the lineups first, so the board knows which goalies to look up.';
  let msg = out.filled.length ? 'Goalie records filled in for ' + out.filled.join(', ') + '.' : 'Goalie records: none of the goalies on the board were found in the media kit.';
  if (out.missing.length) msg += " Couldn't find " + out.missing.join(', ') + ' in the media kit.';
  if (out.unnamed.length) {
    const list = out.unnamed.length > 1 ? out.unnamed.slice(0, -1).join(', ') + ' and ' + out.unnamed[out.unnamed.length - 1] : out.unnamed[0];
    msg += ` Skipped ${list} — nothing in the box yet. Load the lineups, or type the goalie's number and name, then click again.`;
  }
  const skipped = (data.teams || []).reduce((n, t) => n + (t.skipped || 0), 0);
  if (skipped) msg += ` (${skipped} goalie row${skipped === 1 ? '' : 's'} in the kit couldn't be read reliably and ${skipped === 1 ? 'was' : 'were'} left out.)`;
  return msg;
}

/* ===================== COACHES, TEAM RECORDS, PREVIOUS & UPCOMING (from the media kit) ===================== */
// "10-4-0-1 · 21 pts · 1st East · 1st Eastern Conf" (division, then conference)
function teamRecordText(t) {
  return [t.record, t.points != null ? t.points + ' pts' : null, t.division, t.conference && t.conference + ' Conf'].filter(Boolean).join(' · ');
}

// Fill one team's four Previous or Next boxes; boxes left over are emptied so last game's entries don't linger.
function fillGameBoxes(prefix, games) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(prefix + i);
    if (el) el.textContent = games[i - 1] || '';
  }
}

async function fillGamePrepFromKit(url) {
  let res, data;
  try {
    res = await fetch('/api/fetch-game-prep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  } catch (err) { return 'Coaches and records: could not reach the server.'; }
  if (res.status === 404) return "Coaches and records: the server doesn't have the new media kit file yet (mediakit-prep.js) — see the update notes.";
  try { data = await res.json(); } catch (err) { return 'Coaches and records: the server sent back something unexpected.'; }
  if (data.error) return 'Coaches and records: ' + data.error;
  if (!Array.isArray(data.teams) || !data.teams.length) return "Coaches and records: the media kit didn't have any teams in it.";
  // Ottawa always sits on the right of the board, whichever column the kit lists them in.
  const ott = data.teams.find(t => /ottawa|67/i.test(t.team)) || null;
  let opp;
  if (ott) {
    opp = data.teams.find(t => t !== ott);
  } else {
    // A kit for a game Ottawa isn't in (looking ahead at another team): use the kit team that matches the Opponent box.
    const typed = document.getElementById('boardOpponentName').textContent.trim();
    const hasTyped = typed && typed !== OPPONENT_NAME_PLACEHOLDER;
    const names = data.teams.map(t => t.team).join(' and ');
    opp = hasTyped ? data.teams.find(t => sameTeamName(t.team, typed)) : null;
    if (!opp) {
      return hasTyped
        ? `Coaches and records: this media kit is for ${names}, with no Ottawa game, and neither matches the Opponent name "${typed}".`
        : `Coaches and records: this media kit is for ${names}, with no Ottawa game. Type the team's name in the Opponent box and click again.`;
    }
  }
  if (!opp) return "Coaches and records: couldn't tell which team in the media kit is the opponent.";
  // Fill in the opponent's name if it hasn't been typed yet (the lineup panel's heading follows it).
  fillOpponentName(opp.team);
  const filled = [];
  (ott ? [[opp, 'Opp'], [ott, 'Ott']] : [[opp, 'Opp']]).forEach(([t, side]) => {
    if (t.coach) { document.getElementById('boardCoach' + side).textContent = t.coach; filled.push('coach'); }
    if (t.record) { document.getElementById('boardRecord' + side).textContent = teamRecordText(t); filled.push('record'); }
    if (t.scheduleFound) { fillGameBoxes('prev' + side, t.prev); fillGameBoxes('next' + side, t.next); filled.push('games'); }
  });
  if (!filled.length) return 'Coaches and records: nothing found in the media kit.';
  const missing = [];
  if (!opp.coach || (ott && !ott.coach)) missing.push('a head coach');
  if (!opp.scheduleFound || (ott && !ott.scheduleFound)) missing.push("a team's schedule");
  const gaps = missing.length ? " Couldn't find " + missing.join(' or ') + ' in the media kit.' : '';
  if (!ott) return `Head coach, record and previous/upcoming games filled in for ${opp.team}. This kit has no Ottawa game, so the Ottawa side was left alone.` + gaps;
  return 'Head coaches, team records and previous/upcoming games filled in.' + gaps;
}

document.getElementById('specialtyTeamsFetchBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('specialtyTeamsStatus');
  let url = document.getElementById('specialtyTeamsUrl').value.trim();
  if (!url) { statusEl.textContent = 'Paste a media kit PDF link first.'; return; }
  // Strip a PDF-viewer extension wrapper if the person pasted the browser address bar URL directly
  const wrapperMatch = url.match(/^chrome-extension:\/\/[^/]+\/(https?:\/\/.+)$/i);
  if (wrapperMatch) url = wrapperMatch[1];
  statusEl.textContent = 'Reading the media kit…';
  ['specialtyTeamsDebug', 'specialtyTeamsDebugNote'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
  clearGoalieDebug();
  // The parts are independent: one failing never stops the others. Coaches and records go first, since they fill in
  // the opponent's name, which the PP/PK and goalie parts use to find the opponent.
  // Each part is guarded on its own, so even an unexpected error in one can never stop the others from running.
  const guarded = (label, work) => work.catch(err => label + ': something went wrong reading the media kit (' + ((err && err.message) || err) + ').');
  const prepMsg = await guarded('Coaches and records', fillGamePrepFromKit(url));
  const [ppMsg, goalieMsg] = await Promise.all([
    guarded('Power play and penalty kill', fillSpecialTeamsFromKit(url)),
    guarded('Goalie records', fillGoalieRecordsFromKit(url))
  ]);
  statusEl.textContent = [prepMsg, ppMsg, goalieMsg].filter(Boolean).join(' ');
});


/* ===================== GAME LOG & AGGREGATES ===================== */
function filteredGames() {
  const filter = document.getElementById('logFilter').value;
  if (filter === 'All') return games;
  return games.filter(g => (g.gametype || 'Regular Season') === filter);
}
function computeAggregatesForGames(list) {
  const agg = { gp: list.length, w: 0, l: 0, otl: 0, sol: 0, pts: 0, gf: 0, ga: 0, sf: 0, sa: 0,
    ppg: 0, ppo: 0, pk_against: 0, pk_ga: 0, shgf: 0, shga: 0, engf: 0, enga: 0,
    sogf: 0, soga: 0, psgf: 0, psga: 0 };
  list.forEach(g => {
    if (g.result === 'W') { agg.w++; agg.pts += 2; }
    else if (g.result === 'L') { agg.l++; }
    else if (g.result === 'OTL') { agg.otl++; agg.pts += 1; }
    else if (g.result === 'SOL') { agg.sol++; agg.pts += 1; }
    agg.gf += Number(g.gf) || 0; agg.ga += Number(g.ga) || 0;
    agg.sf += Number(g.sf) || 0; agg.sa += Number(g.sa) || 0;
    agg.ppg += Number(g.ppg) || 0; agg.ppo += Number(g.ppo) || 0;
    agg.pk_against += Number(g.pk_against) || 0; agg.pk_ga += Number(g.pk_ga) || 0;
    agg.shgf += Number(g.shgf) || 0; agg.shga += Number(g.shga) || 0;
    agg.engf += Number(g.engf) || 0; agg.enga += Number(g.enga) || 0;
    agg.sogf += Number(g.sogf) || 0; agg.soga += Number(g.soga) || 0;
    agg.psgf += Number(g.psgf) || 0; agg.psga += Number(g.psga) || 0;
  });
  return agg;
}
function computeAggregates() {
  return computeAggregatesForGames(filteredGames());
}
function renderAggregates() {
  const a = computeAggregates();
  const pkKills = a.pk_against - a.pk_ga;
  const ppPct = a.ppo > 0 ? ((a.ppg / a.ppo) * 100).toFixed(1) + '%' : '—';
  const pkPct = a.pk_against > 0 ? ((pkKills / a.pk_against) * 100).toFixed(1) + '%' : '—';
  const diff = a.gf - a.ga; const diffStr = (diff > 0 ? '+' : '') + diff;
  const gpg = a.gp > 0 ? (a.gf / a.gp).toFixed(2) : '0.00';
  const gapg = a.gp > 0 ? (a.ga / a.gp).toFixed(2) : '0.00';
  const sfpg = a.gp > 0 ? (a.sf / a.gp).toFixed(1) : '0.0';
  const sapg = a.gp > 0 ? (a.sa / a.gp).toFixed(1) : '0.0';
  document.getElementById('aggGrid').innerHTML = `
    <div class="agg-card"><div class="val">${a.gp}</div><div class="lbl">Games</div></div>
    <div class="agg-card"><div class="val">${a.w}-${a.l}-${a.otl}-${a.sol}</div><div class="lbl">Record (W-L-OTL-SOL)</div></div>
    <div class="agg-card"><div class="val">${a.pts}</div><div class="lbl">Points</div></div>
    <div class="agg-card"><div class="val">${a.gf}</div><div class="lbl">Goals For</div></div>
    <div class="agg-card"><div class="val">${a.ga}</div><div class="lbl">Goals Against</div></div>
    <div class="agg-card"><div class="val">${diffStr}</div><div class="lbl">Goal Diff</div></div>`;
  document.getElementById('aggGrid2').innerHTML = `
    <div class="agg-card"><div class="val">${gpg}</div><div class="lbl">Goals/Game</div></div>
    <div class="agg-card"><div class="val">${gapg}</div><div class="lbl">GA/Game</div></div>
    <div class="agg-card"><div class="val">${sfpg}</div><div class="lbl">Shots For/Game</div></div>
    <div class="agg-card"><div class="val">${sapg}</div><div class="lbl">Shots Against/Game</div></div>
    <div class="agg-card"><div class="val">${a.ppg}/${a.ppo}</div><div class="lbl">PP (Goals / Opps)</div></div>
    <div class="agg-card"><div class="val">${ppPct}</div><div class="lbl">Power Play %</div></div>
    <div class="agg-card"><div class="val">${pkKills}/${a.pk_against}</div><div class="lbl">PK (Kills / Times SH)</div></div>
    <div class="agg-card"><div class="val">${pkPct}</div><div class="lbl">Penalty Kill %</div></div>
    <div class="agg-card"><div class="val">${a.shgf} / ${a.shga}</div><div class="lbl">SH Goals F/A</div></div>
    <div class="agg-card"><div class="val">${a.engf} / ${a.enga}</div><div class="lbl">EN Goals F/A</div></div>`;
}
function fmtDate(d) { const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function renderGamesList() {
  const list = document.getElementById('gamesList');
  const gamesToShow = filteredGames();
  if (games.length === 0) { list.innerHTML = '<div class="empty-state">No games logged yet.</div>'; return; }
  if (gamesToShow.length === 0) { list.innerHTML = '<div class="empty-state">No games logged for this filter yet.</div>'; return; }
  const sorted = [...gamesToShow].sort((a, b) => new Date(b.date) - new Date(a.date));
  list.innerHTML = sorted.map(g => {
    const vs = g.venue === 'Home' ? 'vs' : '@';
    const typeBadge = (g.gametype && g.gametype !== 'Regular Season') ? ' <span class="type-badge">' + g.gametype + '</span>' : '';
    const extras = [];
    if (g.shgf || g.shga) extras.push('SH ' + (g.shgf || 0) + '-' + (g.shga || 0));
    if (g.engf || g.enga) extras.push('EN ' + (g.engf || 0) + '-' + (g.enga || 0));
    if (g.sogf || g.soga) extras.push('SO ' + (g.sogf || 0) + '-' + (g.soga || 0));
    if (g.psgf || g.psga) extras.push('PS ' + (g.psgf || 0) + '-' + (g.psga || 0));
    return `
    <div class="game-card">
      <div class="game-main">
        <div class="game-top">
          <span class="result-pill ${g.result}">${g.result}</span>
          <span class="game-score">OTT ${g.gf} — ${g.ga} ${g.opponent}</span>
          <span class="game-date">${fmtDate(g.date)}</span>${typeBadge}
        </div>
        <div class="game-meta">
          ${vs} ${g.opponent} · ${g.venue}
          ${g.sf || g.sa ? ' · Shots ' + (g.sf || 0) + '-' + (g.sa || 0) : ''}
          ${g.goalie ? ' · G: ' + g.goalie : ''}
          ${g.ppo ? ' · PP ' + (g.ppg || 0) + '/' + g.ppo : ''}
          ${g.pk_against ? ' · PK ' + (g.pk_against - (g.pk_ga || 0)) + '/' + g.pk_against : ''}
          ${extras.length ? ' · ' + extras.join(' · ') : ''}
        </div>
        ${g.notes ? '<div class="game-notes">' + g.notes.replace(/</g, '&lt;') + '</div>' : ''}
      </div>
      <div class="game-actions">
        <button onclick="editGame('${g.id}')">Edit</button>
        <button onclick="deleteGame('${g.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}
function renderLogTab() { renderAggregates(); renderGamesList(); }
function resetForm() {
  document.getElementById('gameForm').reset();
  editingId = null;
  document.getElementById('submitBtn').textContent = 'Add Game';
  document.getElementById('cancelEditBtn').style.display = 'none';
}
window.editGame = function (id) {
  const g = games.find(x => x.id === id); if (!g) return;
  editingId = id;
  const ids = ['gametype', 'date', 'opponent', 'venue', 'result', 'gf', 'ga', 'sf', 'sa', 'ppg', 'ppo',
    'pk_against', 'pk_ga', 'shgf', 'shga', 'engf', 'enga', 'sogf', 'soga', 'psgf', 'psga',
    'goalie', 'attendance', 'notes'];
  ids.forEach(k => { const el = document.getElementById('f_' + k); if (el) el.value = g[k] ?? ''; });
  document.getElementById('submitBtn').textContent = 'Save Changes';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
window.deleteGame = async function (id) {
  if (!confirm('Delete this game entry?')) return;
  await api('/api/games/' + id, { method: 'DELETE' });
  await loadGames();
  renderLogTab();
};
document.getElementById('cancelEditBtn').addEventListener('click', resetForm);
document.getElementById('logFilter').addEventListener('change', renderLogTab);
document.getElementById('gameForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const numIds = ['gf', 'ga', 'sf', 'sa', 'ppg', 'ppo', 'pk_against', 'pk_ga', 'shgf', 'shga',
    'engf', 'enga', 'sogf', 'soga', 'psgf', 'psga'];
  const entry = {
    gametype: document.getElementById('f_gametype').value,
    date: document.getElementById('f_date').value,
    opponent: document.getElementById('f_opponent').value.trim(),
    venue: document.getElementById('f_venue').value,
    result: document.getElementById('f_result').value,
    goalie: document.getElementById('f_goalie').value.trim(),
    attendance: document.getElementById('f_attendance').value,
    notes: document.getElementById('f_notes').value.trim()
  };
  numIds.forEach(k => entry[k] = Number(document.getElementById('f_' + k).value) || 0);
  if (editingId) { await api('/api/games/' + editingId, { method: 'PUT', body: JSON.stringify(entry) }); }
  else { await api('/api/games', { method: 'POST', body: JSON.stringify(entry) }); }
  await loadGames();
  resetForm();
  renderLogTab();
});
document.getElementById('exportBtn').addEventListener('click', function () {
  if (games.length === 0) { alert('No games to export yet.'); return; }
  const headers = ['GameType', 'Date', 'Opponent', 'Venue', 'Result', 'GF', 'GA', 'SF', 'SA', 'PPG', 'PPO',
    'PK_Against', 'PK_GA', 'SH_GF', 'SH_GA', 'EN_GF', 'EN_GA', 'SO_GF', 'SO_GA', 'PS_GF', 'PS_GA',
    'Goalie', 'Attendance', 'Notes'];
  const rows = games.map(g => [g.gametype || 'Regular Season', g.date, g.opponent, g.venue, g.result,
    g.gf, g.ga, g.sf, g.sa, g.ppg, g.ppo, g.pk_against, g.pk_ga, g.shgf, g.shga, g.engf, g.enga,
    g.sogf, g.soga, g.psgf, g.psga, g.goalie, g.attendance, '"' + (g.notes || '').replace(/"/g, '""') + '"']);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'ottawa_67s_2026-27_games.csv'; a.click();
  URL.revokeObjectURL(url);
});
async function loadGames() {
  games = await api('/api/games');
  document.getElementById('statusText').textContent = 'Connected · ' + games.length + ' game(s) in the database';
}

/* ===================== GAMESHEET PARSER (client-side, same as before) ===================== */
function parseGamesheetText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const teams = {};
  let currentTeam = null, mode = null;
  const posRe = /^(LW|RW|C|LD|RD|D)$/i;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (m = line.match(/^(.+?)\s+Skaters$/i)) { currentTeam = m[1].trim(); teams[currentTeam] = teams[currentTeam] || { skaters: [], goalies: [] }; mode = 'skaters'; i++; continue; }
    if (m = line.match(/^(.+?)\s+Goalies$/i)) { currentTeam = m[1].trim(); teams[currentTeam] = teams[currentTeam] || { skaters: [], goalies: [] }; mode = 'goalies'; i++; continue; }
    if (mode === 'skaters' && posRe.test(line)) {
      const pos = line.toUpperCase(); i++;
      let number = ''; if (i < lines.length && /^\d+$/.test(lines[i])) { number = lines[i]; i++; }
      let name = ''; if (i < lines.length) { name = lines[i]; i++; }
      if (i < lines.length && /^(\*|A|C)$/.test(lines[i])) { i++; }
      const vals = [];
      while (i < lines.length && vals.length < 6 && /^[-+]?\d+(\/\d+)?$/.test(lines[i])) { vals.push(lines[i]); i++; }
      const goals = parseInt(vals[0]) || 0, assists = parseInt(vals[1]) || 0;
      const plusMinus = vals[2] !== undefined ? parseInt(vals[2]) : 0;
      const sog = parseInt(vals[3]) || 0, pim = parseInt(vals[4]) || 0;
      let fow = 0, fol = 0;
      if (vals[5] && vals[5].indexOf('/') > -1) { const p = vals[5].split('/'); fow = parseInt(p[0]) || 0; fol = parseInt(p[1]) || 0; }
      if (currentTeam && name && !/^(no\.|#|player|totals)/i.test(name)) {
        teams[currentTeam].skaters.push({ pos, number, name, goals, assists, points: goals + assists, plusMinus, sog, pim, fow, fol });
      }
      continue;
    }
    if (mode === 'goalies') {
      if (/^#\s*Player/i.test(line) || line === '#') { i++; continue; }
      const tokens = line.split(/\t+|\s{2,}/).filter(Boolean);
      if (tokens.length >= 2 && /^\d+$/.test(tokens[0])) {
        let idx = 1; const nameParts = [];
        while (idx < tokens.length && !/^-?\d+$/.test(tokens[idx]) && !/^\d+:\d+$/.test(tokens[idx])) { nameParts.push(tokens[idx]); idx++; }
        const name = nameParts.join(' ');
        const rest = tokens.slice(idx);
        const ga = parseInt(rest[0]) || 0;
        const min = rest[1] || '';
        const shots = parseInt(rest[2]) || 0;
        let saves = 0;
        if (rest[3] && rest[3].indexOf('/') > -1) saves = parseInt(rest[3].split('/')[0]) || 0;
        else saves = parseInt(rest[3]) || 0;
        const pim = parseInt(rest[4]) || 0;
        if (currentTeam && name) { teams[currentTeam].goalies.push({ name, ga, min, shots, saves, pim }); }
      }
      i++; continue;
    }
    i++;
  }
  return teams;
}

// Every box score lists each penalty under an "ohl-xxx" team tag, and a penalty that actually produced
// a power play ends with "Power Play" (offsetting minors, misconducts etc. don't). Counting those tagged
// penalties recovers each side's power-play opportunities even when the box score omits its "PP / FOW"
// summary table. A 4:00 double minor counts as two opportunities, matching how the official report tallies it.
//   oppPenaltyPP   = Ottawa's power-play opportunities (the opponent took the penalty)
//   ottPenaltyPP   = times Ottawa was shorthanded (Ottawa took the penalty)
function parseBoxScorePenaltySummary(lines) {
  let ottPenaltyPP = 0, oppPenaltyPP = 0, found = 0;
  for (let i = 0; i < lines.length; i++) {
    const tag = lines[i].match(/^ohl-([a-z0-9]+)$/i);
    if (!tag || !/^Penalty/i.test(lines[i + 1] || '')) continue;
    found++;
    const line = lines[i + 1];
    if (!/Power\s*Play\s*$/i.test(line)) continue;
    const dur = line.match(/(\d+):(\d+)\s*Power\s*Play\s*$/i);
    const minutes = dur ? parseInt(dur[1], 10) + parseInt(dur[2], 10) / 60 : 2;
    const count = (minutes >= 4 && minutes < 5) ? 2 : 1;
    if (/ott/i.test(tag[1])) ottPenaltyPP += count; else oppPenaltyPP += count;
  }
  return { ottPenaltyPP, oppPenaltyPP, penaltiesFound: found };
}

function parseShotsAndSpecialTeams(lines) {
  const result = { shots: [], ppFrac: [], ppFow: [] };
  for (let i = 0; i < lines.length; i++) {
    if (/^Shots on Goal$/i.test(lines[i])) {
      const row1 = (lines[i + 2] || '').split(/\t+|\s{2,}/).filter(Boolean);
      const row2 = (lines[i + 3] || '').split(/\t+|\s{2,}/).filter(Boolean);
      [row1, row2].forEach(tokens => {
        if (tokens.length >= 2) {
          const total = parseInt(tokens[tokens.length - 1]);
          if (!isNaN(total)) result.shots.push(total);
        }
      });
    }
    const headTokens = lines[i].split(/\s+/).filter(Boolean);
    if (headTokens.length === 2 && /^PP$/i.test(headTokens[0]) && /^FOW$/i.test(headTokens[1])) {
      const row1 = (lines[i + 1] || '').split(/\t+|\s+/).filter(Boolean);
      const row2 = (lines[i + 2] || '').split(/\t+|\s+/).filter(Boolean);
      [row1, row2].forEach(tokens => {
        if (tokens.length >= 2) { result.ppFrac.push(tokens[0]); result.ppFow.push(parseInt(tokens[1]) || 0); }
      });
    }
  }
  return result;
}

function parseGoalsEvents(lines) {
  const goals = [];
  const FLAG_KEYWORDS = ['GAME WINNING', 'INSURANCE GOAL', 'SHORT HANDED', 'SHORTHANDED', 'POWER PLAY', 'EMPTY NET', 'PENALTY SHOT'];
  const STRENGTH_FLAGS = ['SHORT HANDED', 'SHORTHANDED', 'POWER PLAY', 'EMPTY NET', 'PENALTY SHOT'];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'Goal') {
      const scoreLine = lines[i + 1] || '';
      const timeLine = lines[i + 2] || '';
      const m = scoreLine.match(/^#(\d+)\s+(.+?)\s+\(\d+\)\s+scores\.(.*)$/i);
      if (m) {
        const scorerName = m[2].trim();
        let rest = (m[3] || '').trim();
        // Multiple flags can be concatenated with no separator (e.g. "...McCallumPOWER PLAYGAME WINNING"),
        // so keep stripping recognized flags off the end until none remain.
        const foundFlags = [];
        let changed = true;
        while (changed) {
          changed = false;
          for (const f of FLAG_KEYWORDS) {
            if (rest.toUpperCase().endsWith(f)) { foundFlags.unshift(f); rest = rest.slice(0, rest.length - f.length).replace(/\s+$/, ''); changed = true; break; }
          }
        }
        let strengthHint = null;
        if (foundFlags.some(f => /SHORT ?HANDED/.test(f))) strengthHint = 'SH';
        else if (foundFlags.includes('POWER PLAY')) strengthHint = 'PP';
        else if (foundFlags.includes('EMPTY NET')) strengthHint = 'EN';
        else if (foundFlags.includes('PENALTY SHOT')) strengthHint = 'PS';
        const flag = foundFlags.filter(f => !STRENGTH_FLAGS.includes(f)).join(' ');
        let assists = [];
        const am = rest.match(/Assists:\s*(.*)/i);
        if (am) { assists = am[1].split(',').map(s => s.trim().replace(/^#\d+\s*/, '')).filter(Boolean); }
        const tm = timeLine.match(/^(\S+)\s+(.+)$/);
        const period = tm ? tm[1] : '';
        const time = tm ? tm[2] : '';
        goals.push({ scorerName, assists, period, time, flag, strengthHint });
      }
    }
  }
  return goals;
}

function normalizeName(n) {
  n = (n || '').trim();
  if (n.includes(',')) {
    const parts = n.split(',');
    const last = parts[0].trim();
    const first = (parts[1] || '').trim();
    return (first + ' ' + last).toLowerCase().replace(/\s+/g, ' ');
  }
  return n.toLowerCase().replace(/\s+/g, ' ');
}

function buildTeamIndex(teamsObj) {
  const idx = {};
  Object.keys(teamsObj).forEach(teamName => {
    (teamsObj[teamName].skaters || []).forEach(s => { idx[normalizeName(s.name)] = teamName; });
  });
  return idx;
}

function parseTimeToSeconds(t) {
  const parts = (t || '0:00').split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}
const PERIOD_LENGTH_SECONDS = 1200; // 20-minute regulation period

// Different sources label overtime differently — the official report says "OT", but the box
// score sometimes numbers it as the "4th" period instead. Normalize both to the same label so
// goal-matching and time math treat them as the same period.
function normalizePeriodLabel(p) {
  if (!p) return p;
  const s = p.trim();
  if (/^4(th)?$/i.test(s)) return 'OT';
  if (/^OT/i.test(s)) return 'OT';
  return s;
}

function periodToAbsoluteSeconds(periodLabel, elapsedSeconds) {
  const label = normalizePeriodLabel(periodLabel);
  const map = { '1st': 0, '2nd': 1, '3rd': 2 };
  if (map[label] !== undefined) return map[label] * PERIOD_LENGTH_SECONDS + elapsedSeconds;
  if (label === 'OT') return 3 * PERIOD_LENGTH_SECONDS + elapsedSeconds;
  return 99999 + elapsedSeconds; // SO or unrecognized — keep far away so it never overlaps a real penalty window
}

// Cross-references each penalty's player against the parsed rosters to determine which team
// took the penalty — more reliable than the short team-code tags in the gamesheet text.
function parsePenalties(lines, teams) {
  const idx = buildTeamIndex(teams);
  const allPlayers = Object.keys(idx).sort((a, b) => b.length - a.length);
  const penalties = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^Penalty#(\d+)(.+)$/i);
    if (m) {
      const rest = m[2];
      const restLower = rest.toLowerCase();
      let matchedPlayerNorm = null;
      for (const p of allPlayers) { if (restLower.startsWith(p)) { matchedPlayerNorm = p; break; } }
      const teamName = matchedPlayerNorm ? idx[matchedPlayerNorm] : null;
      const timeLine = lines[i + 1] || '';
      const tm = timeLine.match(/^(\S+)\s+(\d+):(\d+)$/);
      const durMatch = rest.match(/(\d+):(\d+)/);
      let durationSeconds = durMatch ? (parseInt(durMatch[1]) * 60 + parseInt(durMatch[2])) : 120;
      if (tm && teamName) {
        penalties.push({ teamName, period: tm[1], elapsedSeconds: parseInt(tm[2]) * 60 + parseInt(tm[3]), durationSeconds });
      }
    }
  }
  return penalties;
}

// Determines EV / PP / SH for a goal by checking which team(s), if any, had an active
// penalty at that moment. Simultaneous penalties on both sides (4-on-4) count as EV.
function determineGoalStrength(goalAbsTime, scoringTeamName, penalties) {
  let scoringHasPenalty = false, opponentHasPenalty = false;
  penalties.forEach(p => {
    const start = periodToAbsoluteSeconds(p.period, p.elapsedSeconds);
    const end = start + p.durationSeconds;
    if (goalAbsTime >= start && goalAbsTime < end) {
      if (p.teamName === scoringTeamName) scoringHasPenalty = true;
      else opponentHasPenalty = true;
    }
  });
  if (scoringHasPenalty && !opponentHasPenalty) return 'SH';
  if (opponentHasPenalty && !scoringHasPenalty) return 'PP';
  return 'EV';
}

function minToSeconds(m) {
  if (!m) return 0;
  const parts = m.split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function parseGameHeader(lines, teamNames) {
  for (let i = 0; i < lines.length - 4; i++) {
    if (/^Final/i.test(lines[i + 2]) && /^\d+$/.test(lines[i + 1]) && /^\d+$/.test(lines[i + 3])) {
      const shortA = lines[i];
      const scoreA = parseInt(lines[i + 1]);
      const finalLine = lines[i + 2];
      const scoreB = parseInt(lines[i + 3]);
      const shortB = lines[i + 4];
      const wentOT = /OT/i.test(finalLine);
      const wentSO = /SO/i.test(finalLine);

      const fullA = teamNames.find(t => t.toLowerCase().endsWith(shortA.toLowerCase()));
      const fullB = teamNames.find(t => t.toLowerCase().endsWith(shortB.toLowerCase()));

      let ottScore, oppScore, oppFull, venue;
      if (fullA && /67/.test(fullA)) { ottScore = scoreA; oppScore = scoreB; oppFull = fullB; venue = 'Away'; }
      else if (fullB && /67/.test(fullB)) { ottScore = scoreB; oppScore = scoreA; oppFull = fullA; venue = 'Home'; }
      else continue;

      let result;
      if (ottScore > oppScore) result = 'W';
      else if (wentSO) result = 'SOL';
      else if (wentOT) result = 'OTL';
      else result = 'L';

      let gametype = 'Regular Season';
      let dateISO = '';
      for (let j = i + 5; j < Math.min(i + 10, lines.length); j++) {
        const gm = lines[j].match(/^Game\s*#\d+\s*-\s*(.+)$/i);
        if (gm) {
          if (/pre/i.test(gm[1])) gametype = 'Preseason';
          else if (/playoff/i.test(gm[1])) gametype = 'Playoffs';
        }
        const dm = lines[j].match(/^.+?\s-\s(.+?),\s*.+$/);
        if (dm) {
          const cleaned = dm[1].replace(/(\d+)(st|nd|rd|th)/i, '$1');
          const d = new Date(cleaned);
          if (!isNaN(d.getTime())) dateISO = d.toISOString().slice(0, 10);
        }
      }
      return { opponent: oppFull, venue, result, gf: ottScore, ga: oppScore, gametype, dateISO };
    }
  }
  return null;
}

/* ===================== OFFICIAL GAME REPORT PARSER (alternate/supplementary format) =====================
   This format tags each goal with PP/SH directly and lists every skater on the ice (by jersey
   number) for both sides — better strength data than the box-score format can offer. It uses
   real tab characters as column separators, including meaningful blank cells, so lines are
   split on '\t' without collapsing repeated whitespace like the other parsers do. */

function parseOfficialReportMeta(rawLines) {
  const meta = {};
  rawLines.forEach(line => {
    let m;
    if (m = line.match(/^ARENA:\s*(.+)$/i)) meta.arena = m[1].trim();
    if (m = line.match(/^DATE:\s*(.+)$/i)) meta.dateText = m[1].trim();
    if (m = line.match(/^Visiting Team:\s*(.+?)\s*-\s*(\d+)\s*$/i)) { meta.visitingTeam = m[1].trim(); meta.visitingScore = parseInt(m[2]); }
    if (m = line.match(/^Home Team:\s*(.+?)\s*-\s*(\d+)\s*$/i)) { meta.homeTeam = m[1].trim(); meta.homeScore = parseInt(m[2]); }
    if (/Start:/i.test(line)) meta.startTime = line.split(/Start:/i)[1].trim();
    if (/\bEnd:/i.test(line)) meta.endTime = line.split(/End:/i)[1].trim();
    if (/Attendance:/i.test(line)) { const am = line.match(/Attendance:\s*(\d+)/i); if (am) meta.attendance = am[1]; }
  });
  if (meta.dateText) {
    const d = new Date(meta.dateText);
    if (!isNaN(d.getTime())) meta.dateISO = d.toISOString().slice(0, 10);
  }
  return meta;
}

function parseOfficialReportRosters(rawLines) {
  const rosters = {};
  let currentTeam = null;
  for (let i = 0; i < rawLines.length; i++) {
    const m = rawLines[i].match(/^([A-Z][A-Z .'-]+?)\s+LINEUP\s*$/);
    if (m) { currentTeam = m[1].trim(); rosters[currentTeam] = {}; continue; }
    if (currentTeam) {
      if (/PENALTIES\s*$/.test(rawLines[i]) || /^[A-Z][A-Z .'-]+\s+LINEUP\s*$/.test(rawLines[i])) { currentTeam = null; continue; }
      const tokens = rawLines[i].split('\t').map(t => t.trim());
      if (tokens.length >= 3 && /^\d+$/.test(tokens[1]) && tokens[2]) rosters[currentTeam][tokens[1]] = tokens[2];
    }
  }
  return rosters;
}

function parseOfficialReportPenaltyPIM(rawLines) {
  const pimByTeam = {};
  let currentTeam = null;
  for (let i = 0; i < rawLines.length; i++) {
    const m = rawLines[i].match(/^([A-Z][A-Z .'-]+?)\s+PENALTIES\s*$/);
    if (m) { currentTeam = m[1].trim(); pimByTeam[currentTeam] = pimByTeam[currentTeam] || {}; continue; }
    if (currentTeam) {
      if (/LINEUP\s*$/.test(rawLines[i]) || /Goals\s*(\t|$)/.test(rawLines[i]) || /^[A-Z][A-Z .'-]+\s+PENALTIES\s*$/.test(rawLines[i])) { currentTeam = null; continue; }
      const tokens = rawLines[i].split('\t').map(t => t.trim());
      if (tokens.length >= 3 && /^(1st|2nd|3rd|OT|SO)/i.test(tokens[0]) && /^\d+$/.test(tokens[1])) {
        const num = tokens[1];
        const mm = (tokens[2] || '').match(/(\d+):(\d+)/);
        const minutes = mm ? (parseInt(mm[1]) + (parseInt(mm[2]) > 0 ? 1 : 0)) : 0;
        pimByTeam[currentTeam][num] = (pimByTeam[currentTeam][num] || 0) + minutes;
      }
    }
  }
  return pimByTeam;
}

// "POWER PLAY OPPORTUNITIES\nOTTAWA\t1 / 5\nOSHAWA\t0 / 4" — the official report's own team-level PP
// summary. This is the only source of PP/PK numbers when a game is imported from the report alone
// (no box score), since the box score's "PP / FOW" table is a separate, box-score-only section.
function parseOfficialReportPowerPlay(rawLines) {
  const result = {};
  const idx = rawLines.findIndex(l => /^POWER PLAY OPPORTUNITIES$/i.test(l.trim()));
  if (idx === -1) return result;
  for (let j = idx + 1; j < rawLines.length; j++) {
    const line = rawLines[j].trim();
    if (!line) continue;
    if (/^PENALTY SUMMARY$/i.test(line)) break;
    const tokens = line.split('\t').map(t => t.trim()).filter(Boolean);
    let team = null, gf = null, opp = null;
    if (tokens.length >= 2) {
      const m = tokens[1].match(/^(\d+)\s*\/\s*(\d+)$/);
      if (m) { team = tokens[0]; gf = parseInt(m[1]); opp = parseInt(m[2]); }
    }
    if (team === null) {
      const m2 = line.match(/^([A-Z][A-Za-z\s]+?)\s+(\d+)\s*\/\s*(\d+)$/);
      if (m2) { team = m2[1].trim(); gf = parseInt(m2[2]); opp = parseInt(m2[3]); }
    }
    if (team !== null) result[team] = { gf, opportunities: opp };
  }
  return result;
}

function parseOfficialReportGoals(rawLines) {
  const goals = [];
  for (let i = 0; i < rawLines.length; i++) {
    const headerMatch = rawLines[i].match(/^([A-Z][A-Z .'-]+?)\s+Goals\s*(\t|$)/);
    if (headerMatch) {
      const shortTeam = headerMatch[1].trim();
      let j = i + 1;
      while (j < rawLines.length && !/^Per\.?\t/.test(rawLines[j])) {
        if (/Goals\s*(\t|$)/.test(rawLines[j]) || /POWER PLAY/i.test(rawLines[j])) break;
        j++;
      }
      j++;
      while (j < rawLines.length) {
        const row = rawLines[j];
        if (!row.trim()) { j++; continue; }
        if (/Goals\s*(\t|$)/.test(row) || /POWER PLAY/i.test(row) || /PENALTY SUMMARY/i.test(row) || /POINT SUMMARY/i.test(row) || /SCORING/i.test(row)) break;
        const tokens = row.split('\t').map(t => t.trim());
        const period = tokens[0];
        if (!/^(1st|2nd|3rd|OT|SO)/i.test(period)) { j++; continue; }
        const time = tokens[1];
        const strengthRaw = tokens[2] || '';
        const strength = /SH/i.test(strengthRaw) ? 'SH' : (/PP/i.test(strengthRaw) ? 'PP' : (/EN/i.test(strengthRaw) ? 'EN' : (/PS/i.test(strengthRaw) ? 'PS' : 'EV')));
        const gAsNums = (tokens[3] || '').split('-').map(s => s.trim()).filter(Boolean);
        const scorerNum = gAsNums[0] || '';
        const assistNums = gAsNums.slice(1);
        let k = 4; const plus = []; const minus = [];
        while (k < tokens.length && tokens[k] !== '') { plus.push(tokens[k]); k++; }
        while (k < tokens.length && tokens[k] === '') { k++; }
        while (k < tokens.length && tokens[k] !== '') { minus.push(tokens[k]); k++; }
        goals.push({ team: shortTeam, period, time, strength, scorerNum, assistNums, plusNums: plus, minusNums: minus });
        j++;
      }
      i = j - 1;
    }
  }
  return goals;
}

function normalizeGoalTime(t) {
  let s = (t || '').trim();
  if (s.startsWith(':')) s = '0' + s;
  const parts = s.split(':');
  const m = parseInt(parts[0]) || 0;
  const sec = (parts[1] || '0').padStart(2, '0');
  return m + ':' + sec;
}

// Parses the "GOALTENDER/SAVES (Time)" table for exact on-ice windows per goalie. A blank
// period prefix on the "On" column means "picks up where the previous goalie on that team left off".
function parseOfficialReportGoalieTimes(rawLines) {
  const results = [];
  const lastOffPeriodByTeam = {};
  for (let i = 0; i < rawLines.length; i++) {
    if (/^GOALTENDER\/SAVES/i.test(rawLines[i])) {
      let j = i + 1;
      while (j < rawLines.length) {
        const row = rawLines[j];
        if (!row.trim()) { j++; continue; }
        if (/Stars of the Game/i.test(row) || /OFFICIALS/i.test(row) || /TIME OF GAME/i.test(row)) break;
        const tokens = row.split('\t').map(t => t.trim());
        const m = tokens[0].match(/^([A-Z]+)\s*-\s*(.+?)\s*\(\d+:\d+\)/);
        if (m) {
          const teamShort = m[1];
          const decisionMatch = tokens[0].match(/\((W|L|OTL|SOL)\)\s*$/i);
          const decision = decisionMatch ? decisionMatch[1].toUpperCase() : null;
          const name = m[2].trim();
          const onRaw = tokens[tokens.length - 2] || '';
          const offRaw = tokens[tokens.length - 1] || '';
          const onMatch = onRaw.match(/^(\w*)\/(\d+:\d+)$/);
          const offMatch = offRaw.match(/^(\w*)\/(\d+:\d+)$/);
          const onPeriod = onMatch ? (onMatch[1] || lastOffPeriodByTeam[teamShort] || '1st') : '1st';
          const offPeriod = offMatch ? offMatch[1] : null;
          results.push({ teamShort, name, decision, onPeriod, onTime: onMatch ? onMatch[2] : '0:00', offPeriod, offTime: offMatch ? offMatch[2] : null });
          if (offPeriod) lastOffPeriodByTeam[teamShort] = offPeriod;
        }
        j++;
      }
      i = j - 1;
    }
  }
  return results;
}

function compactAggCardsHTML(a) {
  const ppPct = a.ppo > 0 ? ((a.ppg / a.ppo) * 100).toFixed(1) + '%' : '—';
  const pkKills = a.pk_against - a.pk_ga;
  const pkPct = a.pk_against > 0 ? ((pkKills / a.pk_against) * 100).toFixed(1) + '%' : '—';
  const diff = a.gf - a.ga; const diffStr = (diff > 0 ? '+' : '') + diff;
  const card = (v, l) => `<div class="agg-card"><div class="val">${v}</div><div class="lbl">${l}</div></div>`;
  // Same notation as the game cards on the Game Log tab: power play = goals/opportunities, penalty kill = kills/times shorthanded
  return card(a.gp, 'Games') + card(`${a.w}-${a.l}-${a.otl}-${a.sol}`, 'Record (W-L-OTL-SOL)') + card(a.pts, 'Points') +
    card(a.gf, 'Goals For') + card(a.ga, 'Goals Against') + card(diffStr, 'Goal Diff') +
    card(`${a.ppg}/${a.ppo}`, 'PP (Goals / Opps)') + card(ppPct, 'Power Play %') +
    card(`${pkKills}/${a.pk_against}`, 'PK (Kills / Times SH)') + card(pkPct, 'Penalty Kill %') +
    card(a.pk_ga, 'PP Goals Against');
}

function trendsFilteredGames() {
  const filter = document.getElementById('t_typeFilter').value;
  const list = filter === 'All' ? games : games.filter(g => (g.gametype || 'Regular Season') === filter);
  // games from the API are already ordered newest-first
  return [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function renderTrendGrids() {
  const sorted = trendsFilteredGames();
  const last5 = sorted.slice(0, 5);
  const last10 = sorted.slice(0, 10);
  document.getElementById('t_last5').innerHTML = last5.length
    ? compactAggCardsHTML(computeAggregatesForGames(last5))
    : '<div class="empty-state">No games yet for this filter.</div>';
  document.getElementById('t_last10').innerHTML = last10.length
    ? compactAggCardsHTML(computeAggregatesForGames(last10))
    : '<div class="empty-state">No games yet for this filter.</div>';
}

// Computes current/longest point and goal streaks per player from their full chronological game log.
// A streak breaks on any game with 0 points (or 0 goals) — games the player didn't record any stat
// row for aren't counted as either a streak game or a break, since we can't tell dressed-but-scoreless
// apart from didn't-dress from the box score alone.
function computeStreaksFromLog(rows) {
  const byPlayer = {};
  rows.forEach(r => {
    if (!byPlayer[r.name]) byPlayer[r.name] = [];
    byPlayer[r.name].push(r);
  });
  const results = [];
  Object.keys(byPlayer).forEach(name => {
    const gamesForPlayer = byPlayer[name]; // already chronological (ASC) from the API query
    let longestPoint = 0, longestGoal = 0, runPoint = 0, runGoal = 0;
    gamesForPlayer.forEach(g => {
      if (Number(g.points) > 0) { runPoint++; longestPoint = Math.max(longestPoint, runPoint); } else { runPoint = 0; }
      if (Number(g.goals) > 0) { runGoal++; longestGoal = Math.max(longestGoal, runGoal); } else { runGoal = 0; }
    });
    // Current streak = the run ending at the most recent game, walking backward from the end
    let currentPoint = 0, currentGoal = 0;
    for (let i = gamesForPlayer.length - 1; i >= 0; i--) {
      if (Number(gamesForPlayer[i].points) > 0) currentPoint++; else break;
    }
    for (let i = gamesForPlayer.length - 1; i >= 0; i--) {
      if (Number(gamesForPlayer[i].goals) > 0) currentGoal++; else break;
    }
    results.push({ name, gp: gamesForPlayer.length, currentPoint, longestPoint, currentGoal, longestGoal });
  });
  return results;
}

async function renderStreaksTable() {
  const body = document.getElementById('t_streaksBody');
  body.innerHTML = '<tr><td colspan="6" style="color:var(--sub);">Loading…</td></tr>';
  let rows;
  try { rows = await api('/api/skater-game-log'); }
  catch (e) { body.innerHTML = '<tr><td colspan="6" style="color:var(--sub);">Could not load streak data.</td></tr>'; return; }
  const filter = document.getElementById('t_typeFilter').value;
  const filtered = filter === 'All' ? rows : rows.filter(r => (r.gametype || 'Regular Season') === filter);
  const streaks = computeStreaksFromLog(filtered);
  if (streaks.length === 0) { body.innerHTML = '<tr><td colspan="6" style="color:var(--sub);">No player stats saved for this filter yet.</td></tr>'; return; }
  streaks.sort((a, b) => b.currentPoint - a.currentPoint || b.longestPoint - a.longestPoint);
  body.innerHTML = streaks.map(s => `
    <tr>
      <td style="text-align:left;">${s.name}</td>
      <td>${s.gp}</td>
      <td>${s.currentPoint}</td>
      <td>${s.longestPoint}</td>
      <td>${s.currentGoal}</td>
      <td>${s.longestGoal}</td>
    </tr>`).join('');
}

// Determines each game's "starter" (goalie with the most minutes that game), then computes
// consecutive-starts streaks, decisions (W-L-OTL in games they started), and rolling GAA
// across all logged appearances (starts and relief) for each goalie.
function computeGoalieStreaksFromLog(rows) {
  const byGame = {};
  rows.forEach(r => { if (!byGame[r.game_id]) byGame[r.game_id] = []; byGame[r.game_id].push(r); });
  const starterByGame = {};
  Object.keys(byGame).forEach(gid => {
    const list = byGame[gid];
    const starter = list.slice().sort((a, b) => minToSeconds(b.min) - minToSeconds(a.min))[0];
    starterByGame[gid] = starter.name;
  });

  const gameOrder = [];
  const seen = new Set();
  rows.forEach(r => { if (!seen.has(r.game_id)) { seen.add(r.game_id); gameOrder.push({ game_id: r.game_id, result: r.result }); } });

  const goalieNames = [...new Set(rows.map(r => r.name))];
  return goalieNames.map(name => {
    const startedFlags = gameOrder.map(g => starterByGame[g.game_id] === name ? 1 : 0);
    let longestStart = 0, runStart = 0;
    startedFlags.forEach(f => { if (f) { runStart++; longestStart = Math.max(longestStart, runStart); } else runStart = 0; });
    let currentStart = 0;
    for (let i = startedFlags.length - 1; i >= 0; i--) { if (startedFlags[i]) currentStart++; else break; }

    let w = 0, l = 0, otl = 0, sol = 0;
    gameOrder.forEach(g => {
      if (starterByGame[g.game_id] === name) {
        if (g.result === 'W') w++; else if (g.result === 'L') l++; else if (g.result === 'OTL') otl++; else if (g.result === 'SOL') sol++;
      }
    });

    const appearances = rows.filter(r => r.name === name);
    function gaaForLastN(n) {
      const slice = appearances.slice(-n);
      let totalGA = 0, totalSec = 0;
      slice.forEach(a => { totalGA += Number(a.ga) || 0; totalSec += minToSeconds(a.min); });
      if (totalSec === 0) return null;
      return (totalGA / (totalSec / 3600)).toFixed(2);
    }
    return { name, starts: startedFlags.filter(Boolean).length, currentStart, longestStart, w, l, otl, sol,
      gaaLast5: gaaForLastN(5), gaaLast10: gaaForLastN(10) };
  });
}

async function renderGoalieStreaksTable() {
  const body = document.getElementById('t_goalieStreaksBody');
  body.innerHTML = '<tr><td colspan="7" style="color:var(--sub);">Loading…</td></tr>';
  let rows;
  try { rows = await api('/api/goalie-game-log'); }
  catch (e) { body.innerHTML = '<tr><td colspan="7" style="color:var(--sub);">Could not load goalie data.</td></tr>'; return; }
  const filter = document.getElementById('t_typeFilter').value;
  const filtered = filter === 'All' ? rows : rows.filter(r => (r.gametype || 'Regular Season') === filter);
  if (filtered.length === 0) { body.innerHTML = '<tr><td colspan="7" style="color:var(--sub);">No goalie stats saved for this filter yet.</td></tr>'; return; }
  const streaks = computeGoalieStreaksFromLog(filtered);
  streaks.sort((a, b) => b.starts - a.starts);
  body.innerHTML = streaks.map(s => `
    <tr>
      <td style="text-align:left;">${s.name}</td>
      <td>${s.starts}</td>
      <td>${s.currentStart}</td>
      <td>${s.longestStart}</td>
      <td>${s.w}-${s.l}-${s.otl}-${s.sol}</td>
      <td>${s.gaaLast5 ?? '—'}</td>
      <td>${s.gaaLast10 ?? '—'}</td>
    </tr>`).join('');
}

function fmtDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) return '—';
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);
  return mins + ':' + String(secs).padStart(2, '0');
}

// Walks each goalie's ice-time segments in chronological order, treating any goal within a
// segment as resetting the run, and letting the run continue seamlessly across games when a
// segment ends without a goal — this measures actual scoreless ice time, not games played.
function computeIceTimeStreaks(segmentsByGoalie, goalsByGoalie) {
  const results = {};
  Object.keys(segmentsByGoalie).forEach(name => {
    const segments = segmentsByGoalie[name];
    const goals = goalsByGoalie[name] || [];
    let longestGap = 0, currentRun = 0;
    segments.forEach((seg, segIdx) => {
      let cursor = seg.onSec;
      const goalsInSeg = goals.filter(g => g.segIdx === segIdx).map(g => g.absSec).sort((a, b) => a - b);
      goalsInSeg.forEach(gTime => {
        const gap = gTime - cursor;
        currentRun += gap;
        longestGap = Math.max(longestGap, currentRun);
        currentRun = 0;
        cursor = gTime;
      });
      currentRun += ((seg.offSec ?? cursor) - cursor);
    });
    longestGap = Math.max(longestGap, currentRun);
    results[name] = { longestGapSeconds: longestGap, currentStreakSeconds: currentRun };
  });
  return results;
}

async function renderIceTimeTable() {
  const body = document.getElementById('t_iceTimeBody');
  body.innerHTML = '<tr><td colspan="3" style="color:var(--sub);">Loading…</td></tr>';
  let data;
  try { data = await api('/api/goalie-ice-time-log'); }
  catch (e) { body.innerHTML = '<tr><td colspan="3" style="color:var(--sub);">Could not load ice-time data.</td></tr>'; return; }
  const filter = document.getElementById('t_typeFilter').value;
  const segRows = filter === 'All' ? data.segments : data.segments.filter(r => (r.gametype || 'Regular Season') === filter);
  const goalRows = filter === 'All' ? data.attributedGoals : data.attributedGoals.filter(r => (r.gametype || 'Regular Season') === filter);
  if (segRows.length === 0) { body.innerHTML = '<tr><td colspan="3" style="color:var(--sub);">No ice-time data yet — import a game with the official report\'s goaltender On/Off times.</td></tr>'; return; }

  const segmentsByGoalie = {};
  segRows.forEach(r => { if (!segmentsByGoalie[r.name]) segmentsByGoalie[r.name] = []; segmentsByGoalie[r.name].push({ onSec: r.on_seconds, offSec: r.off_seconds, game_id: r.game_id }); });

  const goalsByGoalie = {};
  goalRows.forEach(r => {
    if (!goalsByGoalie[r.name]) goalsByGoalie[r.name] = [];
    const segs = segmentsByGoalie[r.name] || [];
    const segIdx = segs.findIndex(s => s.game_id === r.game_id);
    if (segIdx === -1) return;
    const absSec = periodToAbsoluteSeconds(r.period, parseTimeToSeconds(r.time));
    goalsByGoalie[r.name].push({ segIdx, absSec });
  });

  const streaks = computeIceTimeStreaks(segmentsByGoalie, goalsByGoalie);
  const names = Object.keys(streaks).sort((a, b) => streaks[b].currentStreakSeconds - streaks[a].currentStreakSeconds);
  body.innerHTML = names.map(name => `
    <tr>
      <td style="text-align:left;">${name}</td>
      <td>${fmtDuration(streaks[name].currentStreakSeconds)}</td>
      <td>${fmtDuration(streaks[name].longestGapSeconds)}</td>
    </tr>`).join('');
}

function renderTrendsTab() {
  renderTrendGrids();
  renderStreaksTable();
  renderGoalieStreaksTable();
  renderIceTimeTable();
}
document.getElementById('t_typeFilter').addEventListener('change', renderTrendsTab);
document.getElementById('t_refreshBtn').addEventListener('click', async () => { await loadGames(); renderTrendsTab(); });

async function populatePlayerGameSelect() {
  const sel = document.getElementById('p_gameSelect');
  const sorted = [...games].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (sorted.length === 0) { sel.innerHTML = '<option value="">No games logged yet — add one in Game Log tab first</option>'; return; }
  sel.innerHTML = sorted.map(g => `<option value="${g.id}">${fmtDate(g.date)} — ${g.venue === 'Home' ? 'vs' : '@'} ${g.opponent} (${g.gf}-${g.ga})</option>`).join('');
  await renderStatsTableForSelectedGame();
}
document.getElementById('p_gameSelect').addEventListener('change', renderStatsTableForSelectedGame);
document.getElementById('p_refreshGames').addEventListener('click', populatePlayerGameSelect);
function currentPlayerGameId() { return document.getElementById('p_gameSelect').value; }

async function renderStatsTableForSelectedGame() {
  const gid = currentPlayerGameId();
  if (!gid) { gameGoalTypes = {}; renderSkaterRows([]); renderGoalieRows([]); return; }
  const data = await api('/api/player-stats/' + gid);
  let goalsThisGame = [];
  try { goalsThisGame = await api('/api/goals/' + gid); } catch (e) { /* no goals logged yet */ }
  gameGoalTypes = tallyGoalTypes(ottawaGoalCredits(games.find(g => String(g.id) === String(gid)), goalsThisGame));
  renderSkaterRows(data.skaters || []);
  renderGoalieRows(data.goalies || []);
}
function foPct(fow, fol) { const tot = fow + fol; return tot > 0 ? ((fow / tot) * 100).toFixed(1) + '%' : '—'; }

// Save percentage the way hockey prints it: three decimals, no leading zero (.904). A perfect 1.000 keeps its 1.
function fmtSvPct(saves, shots) {
  const s = Number(shots) || 0;
  if (s <= 0) return '—';
  const v = Math.min(1, (Number(saves) || 0) / s);
  const t = v.toFixed(3);
  return t.startsWith('0') ? t.slice(1) : t;
}
// Goals-against average over 60 minutes
function fmtGaa(ga, totalSeconds) { return totalSeconds > 0 ? ((ga * 3600) / totalSeconds).toFixed(2) : '—'; }
function fmtClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60), s = Math.round(totalSeconds % 60);
  return m + ':' + String(s).padStart(2, '0');
}

/* ===================== PLAYER GOAL TYPES (from the Goals Log) ===================== */
// Power-play (PPG), shorthanded (SHG), game-winning (GWG) and empty-net (ENG) goals for each player. They aren't saved on
// the player rows, so they're read from the Goals Log. Scorer names there come as "First Last" or "Last, First", so
// players are matched on the letters in the name, whatever the order or accents.
function playerKey(name) {
  return (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');
}
const zeroGoalTypes = () => ({ ppg: 0, shg: 0, gwg: 0, eng: 0 });
// Every goal Ottawa scored in one game, tagged with its kind. The league's own "GAME WINNING" tag wins out; with no tag
// on the game, a win's game-winner is Ottawa's (opponent's goals + 1)th goal, but only when the logged goals add up to
// the final score (so a shootout win, or a game with a missing goal, never gets a guess).
function ottawaGoalCredits(game, goals) {
  const ott = goals.filter(g => g.team === 'OTT').slice()
    .sort((a, b) => periodToAbsoluteSeconds(a.period, parseTimeToSeconds(a.time)) - periodToAbsoluteSeconds(b.period, parseTimeToSeconds(b.time)));
  const oppCount = goals.filter(g => g.team === 'OPP').length;
  const flagged = goals.filter(g => /game[\s-]*winning/i.test(g.notes || ''));
  let gwgGoal = null;
  if (flagged.length) gwgGoal = flagged.find(g => g.team === 'OTT') || null;
  else if (game && game.result === 'W' && ott.length === Number(game.gf) && oppCount === Number(game.ga) && ott.length > oppCount) gwgGoal = ott[oppCount];
  return ott.map(g => ({ key: playerKey(g.scorer), strength: g.strength, gwg: g === gwgGoal }));
}
function tallyGoalTypes(credits) {
  const out = {};
  credits.forEach(c => {
    const t = out[c.key] || (out[c.key] = zeroGoalTypes());
    if (c.strength === 'PP') t.ppg++; else if (c.strength === 'SH') t.shg++; else if (c.strength === 'EN') t.eng++;
    if (c.gwg) t.gwg++;
  });
  return out;
}
let gameGoalTypes = {};   // goal types for the game currently shown in the per-game table

/* ===================== SORTABLE COLUMNS ===================== */
// Click any column heading to sort by it; click again to reverse. Names and positions start A→Z, jersey
// numbers and GAA start low→high, every other stat starts with the biggest first. Anything blank (say, FO% for
// a player who took no faceoffs) always sinks to the bottom, whichever way you're sorting.
const POS_RANK = { C: 1, LW: 2, RW: 3, W: 3, LD: 4, RD: 5, D: 6 };
const sortState = {
  skater: { key: null, dir: 'desc' }, goalie: { key: null, dir: 'desc' },
  seasonSkater: { key: null, dir: 'desc' }, seasonGoalie: { key: null, dir: 'desc' }
};
const numOrNull = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const ratioOrNull = (num, den) => den > 0 ? num / den : null;
const textCol = f => ({ get: r => (f(r) || '').toLowerCase(), first: 'asc' });
const numCol = (f, first) => ({ get: r => numOrNull(f(r)), first: first || 'desc' });
const SKATER_COLS = {
  name: textCol(r => r.name),
  pos: { get: r => { const p = (r.pos || '').toUpperCase(); return p ? (POS_RANK[p] ?? 9) : null; }, first: 'asc' },
  number: numCol(r => r.number, 'asc'),
  gp: numCol(r => r.gp), goals: numCol(r => r.goals), assists: numCol(r => r.assists), points: numCol(r => r.points),
  plusMinus: numCol(r => r.plusMinus), ppg: numCol(r => r.ppg), shg: numCol(r => r.shg), gwg: numCol(r => r.gwg), eng: numCol(r => r.eng),
  sog: numCol(r => r.sog), pim: numCol(r => r.pim),
  fow: numCol(r => r.fow), fol: numCol(r => r.fol),
  fopct: { get: r => ratioOrNull(Number(r.fow) || 0, (Number(r.fow) || 0) + (Number(r.fol) || 0)), first: 'desc' }
};
const GOALIE_GAME_COLS = {
  name: textCol(r => r.name), ga: numCol(r => r.ga), min: numCol(r => minToSeconds(String(r.min || ''))),
  shots: numCol(r => r.shots), saves: numCol(r => r.saves), pim: numCol(r => r.pim),
  svpct: { get: r => ratioOrNull(Number(r.saves) || 0, Number(r.shots) || 0), first: 'desc' }
};
const GOALIE_SEASON_COLS = {
  name: textCol(r => r.name), gp: numCol(r => r.gp), min: numCol(r => r.secs), ga: numCol(r => r.ga),
  gaa: { get: r => r.secs > 0 ? (r.ga * 3600) / r.secs : null, first: 'asc' },
  shots: numCol(r => r.shots), saves: numCol(r => r.saves),
  svpct: { get: r => ratioOrNull(r.saves, r.shots), first: 'desc' }
};
// `base` is the table's normal order; it also settles ties (the sort is stable), so equal values keep a sensible order.
function sortRows(rows, state, cols, base) {
  const out = rows.slice().sort(base);
  if (!state.key || !cols[state.key]) return out;
  const col = cols[state.key], mult = state.dir === 'asc' ? 1 : -1;
  return out.sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    const mx = x === null || x === undefined, my = y === null || y === undefined;
    if (mx || my) return mx && my ? 0 : (mx ? 1 : -1);
    return typeof x === 'string' ? mult * x.localeCompare(y) : mult * (x - y);
  });
}
function updateSortArrows(tableId, state) {
  document.querySelectorAll('#' + tableId + ' th[data-sort]').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.sort === state.key) th.classList.add(state.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
  });
}
function wireSortHeaders(tableId, state, cols, onChange) {
  document.querySelectorAll('#' + tableId + ' th[data-sort]').forEach(th => {
    th.classList.add('sortable');
    th.title = 'Click to sort';
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.key === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.key = key; state.dir = (cols[key] && cols[key].first) || 'desc'; }
      updateSortArrows(tableId, state);
      onChange();
    });
  });
}
const defaultSkaterOrder = (a, b) => (Number(b.points) || 0) - (Number(a.points) || 0) || (Number(b.goals) || 0) - (Number(a.goals) || 0);

function renderSkaterRows(rows) {
  const body = document.getElementById('p_statsBody');
  if (rows.length === 0) { body.innerHTML = '<tr><td colspan="17" style="color:var(--sub);">No skater stats yet. Paste a gamesheet above and Parse, or add rows manually.</td></tr>'; return; }
  rows.forEach(r => Object.assign(r, zeroGoalTypes(), gameGoalTypes[playerKey(r.name)] || {}));
  const sorted = sortRows(rows, sortState.skater, SKATER_COLS, defaultSkaterOrder);
  body.innerHTML = sorted.map((r, i) => `
    <tr data-idx="${i}">
      <td contenteditable="true" data-field="name">${r.name || ''}</td>
      <td contenteditable="true" data-field="pos">${r.pos || ''}</td>
      <td contenteditable="true" data-field="number">${r.number || ''}</td>
      <td contenteditable="true" data-field="goals">${r.goals || 0}</td>
      <td contenteditable="true" data-field="assists">${r.assists || 0}</td>
      <td contenteditable="true" data-field="points">${r.points || 0}</td>
      <td contenteditable="true" data-field="plusMinus">${r.plusMinus || 0}</td>
      <td>${r.ppg || 0}</td><td>${r.shg || 0}</td><td>${r.gwg || 0}</td><td>${r.eng || 0}</td>
      <td contenteditable="true" data-field="sog">${r.sog || 0}</td>
      <td contenteditable="true" data-field="pim">${r.pim || 0}</td>
      <td contenteditable="true" data-field="fow">${r.fow || 0}</td>
      <td contenteditable="true" data-field="fol">${r.fol || 0}</td>
      <td>${foPct(r.fow || 0, r.fol || 0)}</td>
      <td class="row-del" onclick="deleteSkaterRow(${i})">✕</td>
    </tr>`).join('');
}
function readSkaterRowsFromTable() {
  const trs = document.querySelectorAll('#p_statsBody tr[data-idx]');
  const rows = [];
  trs.forEach(tr => {
    const name = tr.querySelector('[data-field="name"]').textContent.trim();
    if (!name) return;
    const pos = tr.querySelector('[data-field="pos"]').textContent.trim();
    const number = tr.querySelector('[data-field="number"]').textContent.trim();
    const goals = parseInt(tr.querySelector('[data-field="goals"]').textContent) || 0;
    const assists = parseInt(tr.querySelector('[data-field="assists"]').textContent) || 0;
    let points = parseInt(tr.querySelector('[data-field="points"]').textContent);
    if (isNaN(points)) points = goals + assists;
    const plusMinus = parseInt(tr.querySelector('[data-field="plusMinus"]').textContent) || 0;
    const sog = parseInt(tr.querySelector('[data-field="sog"]').textContent) || 0;
    const pim = parseInt(tr.querySelector('[data-field="pim"]').textContent) || 0;
    const fow = parseInt(tr.querySelector('[data-field="fow"]').textContent) || 0;
    const fol = parseInt(tr.querySelector('[data-field="fol"]').textContent) || 0;
    rows.push({ name, pos, number, goals, assists, points, plusMinus, sog, pim, fow, fol });
  });
  return rows;
}
window.deleteSkaterRow = function (idx) { const rows = readSkaterRowsFromTable(); rows.splice(idx, 1); renderSkaterRows(rows); };
document.getElementById('p_addRowBtn').addEventListener('click', () => {
  const rows = readSkaterRowsFromTable();
  rows.push({ name: 'New Player', pos: '', number: '', goals: 0, assists: 0, points: 0, plusMinus: 0, sog: 0, pim: 0, fow: 0, fol: 0 });
  renderSkaterRows(rows);
});
function renderGoalieRows(rows) {
  const body = document.getElementById('p_goalieBody');
  if (rows.length === 0) { body.innerHTML = '<tr><td colspan="8" style="color:var(--sub);">No goalie stats yet.</td></tr>'; return; }
  body.innerHTML = sortRows(rows, sortState.goalie, GOALIE_GAME_COLS, () => 0).map((r, i) => {
    const svpct = fmtSvPct(r.saves, r.shots);
    return `
    <tr data-idx="${i}" data-on="${r.on_seconds ?? ''}" data-off="${r.off_seconds ?? ''}">
      <td contenteditable="true" data-field="name">${r.name || ''}</td>
      <td contenteditable="true" data-field="ga">${r.ga || 0}</td>
      <td contenteditable="true" data-field="min">${r.min || ''}</td>
      <td contenteditable="true" data-field="shots">${r.shots || 0}</td>
      <td contenteditable="true" data-field="saves">${r.saves || 0}</td>
      <td>${svpct}</td>
      <td contenteditable="true" data-field="pim">${r.pim || 0}</td>
      <td class="row-del" onclick="deleteGoalieRow(${i})">✕</td>
    </tr>`;
  }).join('');
}
function readGoalieRowsFromTable() {
  const trs = document.querySelectorAll('#p_goalieBody tr[data-idx]');
  const rows = [];
  trs.forEach(tr => {
    const name = tr.querySelector('[data-field="name"]').textContent.trim();
    if (!name) return;
    const ga = parseInt(tr.querySelector('[data-field="ga"]').textContent) || 0;
    const min = tr.querySelector('[data-field="min"]').textContent.trim();
    const shots = parseInt(tr.querySelector('[data-field="shots"]').textContent) || 0;
    const saves = parseInt(tr.querySelector('[data-field="saves"]').textContent) || 0;
    const pim = parseInt(tr.querySelector('[data-field="pim"]').textContent) || 0;
    const row = { name, ga, min, shots, saves, pim };
    // the goalie's on-ice window isn't a visible column, so carry it through (sorting or saving must not drop it)
    if (tr.dataset.on !== undefined && tr.dataset.on !== '') row.on_seconds = Number(tr.dataset.on);
    if (tr.dataset.off !== undefined && tr.dataset.off !== '') row.off_seconds = Number(tr.dataset.off);
    rows.push(row);
  });
  return rows;
}
window.deleteGoalieRow = function (idx) { const rows = readGoalieRowsFromTable(); rows.splice(idx, 1); renderGoalieRows(rows); };
document.getElementById('p_addGoalieRow').addEventListener('click', () => {
  const rows = readGoalieRowsFromTable();
  rows.push({ name: 'New Goalie', ga: 0, min: '', shots: 0, saves: 0, pim: 0 });
  renderGoalieRows(rows);
});
document.getElementById('p_importNewGameBtn').addEventListener('click', async () => {
  const boxText = document.getElementById('p_pasteArea').value;
  const reportText = document.getElementById('p_pasteAreaReport').value;
  if (!boxText.trim() && !reportText.trim()) { alert('Paste at least one gamesheet (box score or official report) first.'); return; }

  let teams = null, teamNames = [], summary = null, goalsRaw = null, header = null, ottIdx = -1, oppIdx = -1, lines = [];
  if (boxText.trim()) {
    teams = parseGamesheetText(boxText);
    teamNames = Object.keys(teams);
    if (teamNames.length < 2) { alert('Could not find two "Skaters" sections in the box-score text. Make sure you pasted the full gamesheet, including both teams.'); return; }
    lines = boxText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    summary = parseShotsAndSpecialTeams(lines);
    goalsRaw = parseGoalsEvents(lines);
    header = parseGameHeader(lines, teamNames);
    ottIdx = teamNames.findIndex(t => /67/.test(t));
    oppIdx = ottIdx === 0 ? 1 : 0;
  }

  let reportMeta = null, reportRosters = null, reportGoals = null, reportPim = null, reportPP = null, reportOttShort = null, reportOppShort = null, ottSegments = [], ottSpanByName = {};
  if (reportText.trim()) {
    const rawLines = reportText.split('\n').map(l => l.replace(/\r$/, ''));
    reportMeta = parseOfficialReportMeta(rawLines);
    reportRosters = parseOfficialReportRosters(rawLines);
    reportGoals = parseOfficialReportGoals(rawLines);
    reportPim = parseOfficialReportPenaltyPIM(rawLines);
    reportPP = parseOfficialReportPowerPlay(rawLines);
    const shortNames = Object.keys(reportRosters);
    reportOttShort = shortNames.find(t => /ottawa|67/i.test(t));
    reportOppShort = shortNames.find(t => t !== reportOttShort);

    const reportGoalieTimes = parseOfficialReportGoalieTimes(rawLines);
    const ottBoxScoreGoalies = (teams && teams[teamNames[ottIdx]]) ? teams[teamNames[ottIdx]].goalies : null;
    const ottTimeEntries = reportGoalieTimes.filter(t => {
      if (/OTT/i.test(t.teamShort)) return true;
      if (ottBoxScoreGoalies) return ottBoxScoreGoalies.some(g => g.name.toLowerCase().includes(t.name.toLowerCase()));
      return false;
    });
    ottSegments = ottTimeEntries.map(t => {
      let resolvedName = t.name;
      if (ottBoxScoreGoalies) {
        const match = ottBoxScoreGoalies.find(g => g.name.toLowerCase().includes(t.name.toLowerCase()));
        if (match) resolvedName = match.name;
      }
      return {
        name: resolvedName,
        on_seconds: periodToAbsoluteSeconds(t.onPeriod, parseTimeToSeconds(t.onTime)),
        off_seconds: t.offPeriod ? periodToAbsoluteSeconds(t.offPeriod, parseTimeToSeconds(t.offTime)) : null
      };
    });
    // A goalie swapped out and back in (e.g. a delayed penalty call) produces multiple segments with
    // the same name. attributeGoalie() below correctly checks every individual segment — but for the
    // one row saved per goalie, collapse same-named segments into a single earliest-on/latest-off span
    // so their stored ice time covers the whole game, not just whichever segment happened to come first.
    ottSpanByName = {};
    ottSegments.forEach(s => {
      const cur = ottSpanByName[s.name];
      if (!cur) { ottSpanByName[s.name] = { on_seconds: s.on_seconds, off_seconds: s.off_seconds }; return; }
      cur.on_seconds = Math.min(cur.on_seconds, s.on_seconds);
      if (cur.off_seconds !== null && s.off_seconds !== null) cur.off_seconds = Math.max(cur.off_seconds, s.off_seconds);
      else cur.off_seconds = null;
    });
    // Attach ice-time windows onto the matching box-score goalie rows, if box score was pasted
    if (teams && teams[teamNames[ottIdx]]) {
      teams[teamNames[ottIdx]].goalies = teams[teamNames[ottIdx]].goalies.map(gk => {
        const span = ottSpanByName[gk.name];
        return span ? { ...gk, on_seconds: span.on_seconds, off_seconds: span.off_seconds } : gk;
      });
    }
  }
  function attributeGoalie(absTime) {
    const seg = ottSegments.find(s => absTime >= s.on_seconds && (s.off_seconds === null || absTime <= s.off_seconds));
    return seg ? seg.name : null;
  }

  let ottDecision = null;
  if (reportText.trim()) {
    const rawLinesForDecision = reportText.split('\n').map(l => l.replace(/\r$/, ''));
    const allTimes = parseOfficialReportGoalieTimes(rawLinesForDecision);
    const ottEntry = allTimes.find(t => /OTT/i.test(t.teamShort) && t.decision);
    if (ottEntry) ottDecision = ottEntry.decision;
  }

  // Build the game record: prefer box-score header (more reliable for score/date/venue), fall back to report meta
  let newGame;
  if (header) {
    newGame = {
      gametype: header.gametype, date: header.dateISO || '', opponent: header.opponent || (teamNames[oppIdx] || ''),
      venue: header.venue, result: ottDecision || header.result, gf: header.gf, ga: header.ga,
      sf: summary.shots[ottIdx] ?? 0, sa: summary.shots[oppIdx] ?? 0,
      ppg: 0, ppo: 0, pk_against: 0, pk_ga: 0,
      shgf: 0, shga: 0, engf: 0, enga: 0, sogf: 0, soga: 0, psgf: 0, psga: 0,
      goalie: '', attendance: '', notes: ''
    };
    if (summary.ppFrac[ottIdx]) { const [g_, o_] = summary.ppFrac[ottIdx].split('/').map(n => parseInt(n) || 0); newGame.ppg = g_; newGame.ppo = o_; }
    if (summary.ppFrac[oppIdx]) { const [g_, o_] = summary.ppFrac[oppIdx].split('/').map(n => parseInt(n) || 0); newGame.pk_ga = g_; newGame.pk_against = o_; }
    const ottGoalies = (teams[teamNames[ottIdx]].goalies || []);
    if (ottGoalies.length) newGame.goalie = ottGoalies.slice().sort((a, b) => minToSeconds(b.min) - minToSeconds(a.min))[0].name;
  } else if (reportMeta && reportMeta.homeTeam) {
    const ottIsHome = /ottawa|67/i.test(reportMeta.homeTeam);
    newGame = {
      gametype: 'Regular Season', date: reportMeta.dateISO || '',
      opponent: ottIsHome ? reportMeta.visitingTeam : reportMeta.homeTeam,
      venue: ottIsHome ? 'Home' : 'Away',
      gf: ottIsHome ? reportMeta.homeScore : reportMeta.visitingScore,
      ga: ottIsHome ? reportMeta.visitingScore : reportMeta.homeScore,
      sf: 0, sa: 0, ppg: 0, ppo: 0, pk_against: 0, pk_ga: 0,
      shgf: 0, shga: 0, engf: 0, enga: 0, sogf: 0, soga: 0, psgf: 0, psga: 0,
      goalie: '', attendance: '', notes: ''
    };
    newGame.result = ottDecision || (newGame.gf > newGame.ga ? 'W' : 'L');
  } else {
    alert('Could not find a score header in either pasted text. Try the manual Add Game form instead.');
    return;
  }
  // The box score's "PP / FOW" table is the preferred source (already in newGame.ppg etc. above if
  // present). When that's missing — always true in standalone/report-only mode, since that table lives
  // only in the box score — fall back to the report's own "POWER PLAY OPPORTUNITIES" section instead of
  // silently leaving these at zero.
  if (reportPP && newGame.ppo === 0 && newGame.pk_against === 0) {
    const ottPP = reportOttShort && reportPP[reportOttShort];
    const oppPP = reportOppShort && reportPP[reportOppShort];
    if (ottPP) { newGame.ppg = ottPP.gf; newGame.ppo = ottPP.opportunities; }
    if (oppPP) { newGame.pk_ga = oppPP.gf; newGame.pk_against = oppPP.opportunities; }
  }
  // ---- Team numbers from whatever the box score does contain ----
  // The box score's own shots / "PP / FOW" tables aren't always part of what gets pasted, and when the game
  // record is started from the official report (no score header in the box-score paste) they were never
  // consulted at all. Fall back, in order, to: the box-score tables -> the report's PP section (above) ->
  // numbers recovered from the skater SOG column and the penalties tagged "Power Play".
  const offenseFromOfficial = newGame.ppo > 0 || newGame.ppg > 0;
  const defenseFromOfficial = newGame.pk_against > 0 || newGame.pk_ga > 0;
  const hasPPTable = !!(summary && ottIdx >= 0 && summary.ppFrac[ottIdx] && summary.ppFrac[oppIdx]);
  let derivedShotsNote = '';
  if (teams && ottIdx >= 0) {
    if (newGame.sf === 0 && newGame.sa === 0) {
      if (summary && summary.shots[ottIdx] !== undefined && summary.shots[oppIdx] !== undefined) {
        newGame.sf = summary.shots[ottIdx]; newGame.sa = summary.shots[oppIdx];
      } else {
        const sumSog = t => (teams[t].skaters || []).reduce((n, s) => n + (Number(s.sog) || 0), 0);
        newGame.sf = sumSog(teamNames[ottIdx]); newGame.sa = sumSog(teamNames[oppIdx]);
        derivedShotsNote = ' (shots totalled from each skater\'s SOG)';
      }
    }
    if (!offenseFromOfficial && !defenseFromOfficial && hasPPTable) {
      const [og, oo] = summary.ppFrac[ottIdx].split('/').map(n => parseInt(n) || 0);
      const [pg, po] = summary.ppFrac[oppIdx].split('/').map(n => parseInt(n) || 0);
      newGame.ppg = og; newGame.ppo = oo; newGame.pk_ga = pg; newGame.pk_against = po;
    }
    const pen = parseBoxScorePenaltySummary(lines);
    if (!hasPPTable && !offenseFromOfficial) newGame.ppo = pen.oppPenaltyPP;
    if (!hasPPTable && !defenseFromOfficial) newGame.pk_against = pen.ottPenaltyPP;
    if (!newGame.goalie) {
      const og = (teams[teamNames[ottIdx]].goalies || []);
      if (og.length) newGame.goalie = og.slice().sort((a, b) => minToSeconds(b.min) - minToSeconds(a.min))[0].name;
    }
  }
  const deriveOffense = !offenseFromOfficial && !hasPPTable;   // PP goals for = goals tagged PP, counted after the goals are saved
  const deriveDefense = !defenseFromOfficial && !hasPPTable;   // PP goals against, likewise
  if (reportMeta && reportMeta.attendance) newGame.attendance = reportMeta.attendance;
  if (reportMeta && (reportMeta.arena || reportMeta.startTime || reportMeta.endTime)) {
    const bits = [];
    if (reportMeta.arena) bits.push('Arena: ' + reportMeta.arena);
    if (reportMeta.startTime) bits.push('Start: ' + reportMeta.startTime);
    if (reportMeta.endTime) bits.push('End: ' + reportMeta.endTime);
    newGame.notes = (newGame.notes ? newGame.notes + ' | ' : '') + bits.join(', ');
  }

  const goalCount = goalsRaw ? goalsRaw.length : (reportGoals ? reportGoals.length : 0);
  const confirmMsg = `Create new game:\n${newGame.venue === 'Home' ? 'vs' : '@'} ${newGame.opponent}\n${newGame.date || '(date not detected — you can fix it after)'}\nFinal: ${newGame.gf}-${newGame.ga} (${newGame.result})\n\nThis will save skater/goalie stats (if a box score was pasted) and ${goalCount} goal(s). Continue?`;
  if (!confirm(confirmMsg)) return;

  const created = await api('/api/games', { method: 'POST', body: JSON.stringify(newGame) });
  const gid = created.id;

  // Save skater/goalie stats — from box score if present, otherwise a partial build from the report's own goals + PIM table
  if (teams) {
    await api('/api/player-stats/' + gid, {
      method: 'PUT',
      body: JSON.stringify({ skaters: teams[teamNames[ottIdx]].skaters, goalies: teams[teamNames[ottIdx]].goalies })
    });
  } else if (reportRosters && reportOttShort) {
    const roster = reportRosters[reportOttShort];
    const pimMap = (reportPim && reportPim[reportOttShort]) || {};
    const tally = {};
    Object.keys(roster).forEach(num => { tally[num] = { name: roster[num], goals: 0, assists: 0 }; });
    reportGoals.filter(g => g.team === reportOttShort).forEach(g => {
      if (tally[g.scorerNum]) tally[g.scorerNum].goals++;
      g.assistNums.forEach(an => { if (tally[an]) tally[an].assists++; });
    });
    const skaters = Object.keys(tally).map(num => ({
      name: tally[num].name, pos: '', number: num,
      goals: tally[num].goals, assists: tally[num].assists, points: tally[num].goals + tally[num].assists,
      plusMinus: 0, sog: 0, pim: pimMap[num] || 0, fow: 0, fol: 0
    }));
    let syntheticGoalies = [];
    if (ottSegments.length) {
      const oppGoals = reportGoals.filter(g => g.team === reportOppShort);
      const gaCount = {};
      Object.keys(ottSpanByName).forEach(name => { gaCount[name] = 0; });
      oppGoals.forEach(g => {
        const attributed = attributeGoalie(periodToAbsoluteSeconds(g.period, parseTimeToSeconds(g.time)));
        if (attributed && gaCount[attributed] !== undefined) gaCount[attributed]++;
      });
      syntheticGoalies = Object.keys(ottSpanByName).map(name => {
        const s = ottSpanByName[name];
        const durationSec = (s.off_seconds ?? periodToAbsoluteSeconds('3rd', 1200)) - s.on_seconds;
        const mins = Math.floor(durationSec / 60), secs = durationSec % 60;
        return { name, ga: gaCount[name] || 0, min: mins + ':' + String(secs).padStart(2, '0'),
          shots: 0, saves: 0, pim: 0, on_seconds: s.on_seconds, off_seconds: s.off_seconds };
      });
    }
    await api('/api/player-stats/' + gid, { method: 'PUT', body: JSON.stringify({ skaters, goalies: syntheticGoalies }) });
  }

  // Build and save the goals log, merging strength/on-ice data from the report when both sources are present
  let ppCount = 0, shCount = 0;
  const goalTally = { OTT: { EV: 0, PP: 0, SH: 0, EN: 0, PS: 0 }, OPP: { EV: 0, PP: 0, SH: 0, EN: 0, PS: 0 } };
  if (goalsRaw) {
    const idx = buildTeamIndex(teams);
    const ottTeamName = teamNames[ottIdx];
    const penalties = parsePenalties(lines, teams);
    for (const g of goalsRaw) {
      const teamName = idx[normalizeName(g.scorerName)];
      const teamCode = teamName === ottTeamName ? 'OTT' : 'OPP';
      let strength;
      let onIceNote = '';
      let matchedReportGoal = null;
      if (reportGoals) {
        matchedReportGoal = reportGoals.find(rg => normalizePeriodLabel(rg.period) === normalizePeriodLabel(g.period) && normalizeGoalTime(rg.time) === normalizeGoalTime(g.time));
      }
      if (matchedReportGoal) {
        strength = matchedReportGoal.strength;
        const scoringShort = matchedReportGoal.team;
        const otherShort = Object.keys(reportRosters).find(t => t !== scoringShort);
        const plusNames = matchedReportGoal.plusNums.map(n => (reportRosters[scoringShort] || {})[n]).filter(Boolean);
        const minusNames = matchedReportGoal.minusNums.map(n => (reportRosters[otherShort] || {})[n]).filter(Boolean);
        if (plusNames.length || minusNames.length) {
          onIceNote = `On ice for: ${plusNames.join(', ')}. On ice against: ${minusNames.join(', ')}.`;
        }
      } else if (g.strengthHint) {
        strength = g.strengthHint;
      } else {
        const absTime = periodToAbsoluteSeconds(g.period, parseTimeToSeconds(g.time));
        strength = determineGoalStrength(absTime, teamName, penalties);
      }
      if (strength === 'PP') ppCount++;
      if (strength === 'SH') shCount++;
      if (goalTally[teamCode] && goalTally[teamCode][strength] !== undefined) goalTally[teamCode][strength]++;
      const notes = [g.flag, onIceNote].filter(Boolean).join(' — ');
      const attributedGoalie = (teamCode === 'OPP' && ottSegments.length) ? attributeGoalie(periodToAbsoluteSeconds(g.period, parseTimeToSeconds(g.time))) : null;
      await api('/api/goals/' + gid, {
        method: 'POST',
        body: JSON.stringify({ period: g.period, time: g.time, team: teamCode, strength, scorer: g.scorerName, assists: g.assists.join(', '), notes, goalie: attributedGoalie })
      });
    }
  } else if (reportGoals) {
    for (const g of reportGoals) {
      const teamCode = g.team === reportOttShort ? 'OTT' : 'OPP';
      const scorerName = (reportRosters[g.team] || {})[g.scorerNum] || ('#' + g.scorerNum);
      const assistNames = g.assistNums.map(n => (reportRosters[g.team] || {})[n] || ('#' + n));
      const otherShort = g.team === reportOttShort ? reportOppShort : reportOttShort;
      const plusNames = g.plusNums.map(n => (reportRosters[g.team] || {})[n]).filter(Boolean);
      const minusNames = g.minusNums.map(n => (reportRosters[otherShort] || {})[n]).filter(Boolean);
      const onIceNote = (plusNames.length || minusNames.length) ? `On ice for: ${plusNames.join(', ')}. On ice against: ${minusNames.join(', ')}.` : '';
      if (g.strength === 'PP') ppCount++;
      if (g.strength === 'SH') shCount++;
      if (goalTally[teamCode] && goalTally[teamCode][g.strength] !== undefined) goalTally[teamCode][g.strength]++;
      const attributedGoalie = (teamCode === 'OPP' && ottSegments.length) ? attributeGoalie(periodToAbsoluteSeconds(g.period, parseTimeToSeconds(g.time))) : null;
      await api('/api/goals/' + gid, {
        method: 'POST',
        body: JSON.stringify({ period: g.period, time: g.time, team: teamCode, strength: g.strength, scorer: scorerName, assists: assistNames.join(', '), notes: onIceNote, goalie: attributedGoalie })
      });
    }
  }

  // Fill the game record's special-teams totals from the goals just saved. These fields used to be hard-coded
  // to zero on import, so empty-net / shorthanded / penalty-shot counts never reached the Game Log even though
  // every goal row itself was tagged correctly.
  const finalGame = { ...newGame,
    shgf: goalTally.OTT.SH, shga: goalTally.OPP.SH,
    engf: goalTally.OTT.EN, enga: goalTally.OPP.EN,
    psgf: goalTally.OTT.PS, psga: goalTally.OPP.PS };
  if (deriveOffense) { finalGame.ppg = goalTally.OTT.PP; finalGame.ppo = Math.max(finalGame.ppo, finalGame.ppg); }
  if (deriveDefense) { finalGame.pk_ga = goalTally.OPP.PP; finalGame.pk_against = Math.max(finalGame.pk_against, finalGame.pk_ga); }
  try { await api('/api/games/' + gid, { method: 'PUT', body: JSON.stringify(finalGame) }); }
  catch (e) { /* game and goals are already saved; the totals can still be edited on the Game Log tab */ }

  await loadGames();
  renderLogTab();
  await populatePlayerGameSelect();
  document.getElementById('p_gameSelect').value = gid;
  await renderStatsTableForSelectedGame();
  await populateGoalsGameSelect();

  const skaterCount = teams ? teams[teamNames[ottIdx]].skaters.length : (reportRosters && reportOttShort ? Object.keys(reportRosters[reportOttShort]).length : 0);
  const specialBits = [];
  if (goalTally.OTT.PP || goalTally.OPP.PP) specialBits.push(`power-play goals ${goalTally.OTT.PP} for / ${goalTally.OPP.PP} against`);
  if (goalTally.OTT.SH || goalTally.OPP.SH) specialBits.push(`shorthanded goals ${goalTally.OTT.SH} for / ${goalTally.OPP.SH} against`);
  if (goalTally.OTT.EN || goalTally.OPP.EN) specialBits.push(`empty-net goals ${goalTally.OTT.EN} for / ${goalTally.OPP.EN} against`);
  if (goalTally.OTT.PS || goalTally.OPP.PS) specialBits.push(`penalty-shot goals ${goalTally.OTT.PS} for / ${goalTally.OPP.PS} against`);
  const teamLine = `Team numbers: shots ${finalGame.sf}–${finalGame.sa}, power play ${finalGame.ppg}/${finalGame.ppo}, penalty kill ${finalGame.pk_against - finalGame.pk_ga}/${finalGame.pk_against}${derivedShotsNote}.`;
  let successMsg = `Created the game vs ${newGame.opponent} with ${skaterCount} skaters and ${goalCount} goal(s) logged` +
    (specialBits.length ? ' (' + specialBits.join('; ') + ')' : '') + `.\n${teamLine}\nPlease double-check the date, venue, and result on the Game Log tab.`;
  if (goalCount === 0) {
    successMsg = `Created the game vs ${newGame.opponent}, but no individual goals could be parsed from the pasted text — the Goals Log for this game will be empty. Check that the pasted text includes the full "Goals" section, or add goals manually on the Goals Log tab.\n\n` + successMsg;
  }
  alert(successMsg);
  document.getElementById('p_pasteArea').value = '';
  document.getElementById('p_pasteAreaReport').value = '';
});

document.getElementById('p_saveGameStats').addEventListener('click', async () => {
  const gid = currentPlayerGameId();
  if (!gid) { alert('Select or add a game first (in the Game Log tab).'); return; }
  const payload = { skaters: readSkaterRowsFromTable(), goalies: readGoalieRowsFromTable() };
  await api('/api/player-stats/' + gid, { method: 'PUT', body: JSON.stringify(payload) });
  await renderSeasonPlayerTotals();
  alert('Saved stats for this game.');
});
// Cumulative season totals for every player, built from each saved game's stats so the game-type
// filter (Regular Season / Preseason / Playoffs / All) applies to skaters and goalies alike.
async function renderSeasonPlayerTotals() {
  const skBody = document.getElementById('p_seasonBody');
  const gkBody = document.getElementById('p_seasonGoalieBody');
  const filter = document.getElementById('p_seasonTypeFilter').value;
  let allGames;
  try { allGames = await api('/api/games'); }
  catch (e) {
    skBody.innerHTML = '<tr><td colspan="16" style="color:var(--sub);">Could not load season totals.</td></tr>';
    gkBody.innerHTML = '<tr><td colspan="8" style="color:var(--sub);">Could not load season totals.</td></tr>';
    return;
  }
  // oldest first, so the jersey number shown is each player's most recent one
  const picked = (filter === 'All' ? allGames : allGames.filter(g => (g.gametype || 'Regular Season') === filter))
    .slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const perGame = await Promise.all(picked.map(g => api('/api/player-stats/' + g.id).catch(() => null)));
  const goalsPerGame = await Promise.all(picked.map(g => api('/api/goals/' + g.id).catch(() => [])));

  const skaters = {}, goalies = {};
  perGame.forEach(d => {
    if (!d) return;
    (d.skaters || []).forEach(r => {
      const name = (r.name || '').trim();
      if (!name) return;
      const p = skaters[name] || (skaters[name] = { name, number: '', gp: 0, goals: 0, assists: 0, plusMinus: 0, sog: 0, pim: 0, fow: 0, fol: 0 });
      p.gp++;
      p.goals += Number(r.goals) || 0; p.assists += Number(r.assists) || 0; p.plusMinus += Number(r.plusMinus) || 0;
      p.sog += Number(r.sog) || 0; p.pim += Number(r.pim) || 0; p.fow += Number(r.fow) || 0; p.fol += Number(r.fol) || 0;
      if (r.number) p.number = r.number;
    });
    (d.goalies || []).forEach(r => {
      const name = (r.name || '').trim();
      if (!name) return;
      const secs = minToSeconds(String(r.min || ''));
      const shots = Number(r.shots) || 0;
      if (secs <= 0 && shots <= 0) return;           // dressed as the backup but never played
      const g = goalies[name] || (goalies[name] = { name, gp: 0, secs: 0, ga: 0, shots: 0, saves: 0 });
      g.gp++; g.secs += secs; g.ga += Number(r.ga) || 0; g.shots += shots; g.saves += Number(r.saves) || 0;
    });
  });

  const credits = [];
  picked.forEach((g, i) => ottawaGoalCredits(g, goalsPerGame[i] || []).forEach(c => credits.push(c)));
  const typesByKey = tallyGoalTypes(credits);
  const skaterKeys = new Set(Object.values(skaters).map(p => playerKey(p.name)));
  const unmatched = credits.filter(c => !skaterKeys.has(c.key)).length;
  Object.values(skaters).forEach(p => { p.points = p.goals + p.assists; Object.assign(p, zeroGoalTypes(), typesByKey[playerKey(p.name)] || {}); });
  const gamesCounted = perGame.filter(d => d && ((d.skaters || []).length || (d.goalies || []).length)).length;
  seasonData = { skaters: Object.values(skaters), goalies: Object.values(goalies), games: gamesCounted, unmatched };
  paintSeasonTables();
}
let seasonData = { skaters: [], goalies: [], games: 0, unmatched: 0 };
function paintSeasonTables() {
  const skBody = document.getElementById('p_seasonBody');
  const gkBody = document.getElementById('p_seasonGoalieBody');
  const skBase = (a, b) => b.points - a.points || b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name);
  const skList = sortRows(seasonData.skaters, sortState.seasonSkater, SKATER_COLS, skBase);
  skBody.innerHTML = skList.length === 0
    ? '<tr><td colspan="16" style="color:var(--sub);">No skater stats saved for this filter yet.</td></tr>'
    : skList.map(p => `
    <tr>
      <td style="text-align:left;">${p.name}</td><td>${p.number}</td>
      <td>${p.gp}</td><td>${p.goals}</td><td>${p.assists}</td><td>${p.points}</td>
      <td>${p.plusMinus > 0 ? '+' : ''}${p.plusMinus}</td><td>${p.ppg}</td><td>${p.shg}</td><td>${p.gwg}</td><td>${p.eng}</td><td>${p.sog}</td><td>${p.pim}</td>
      <td>${p.fow}</td><td>${p.fol}</td><td>${foPct(p.fow, p.fol)}</td>
    </tr>`).join('');
  const unmatchedNote = document.getElementById('p_seasonUnmatched');
  unmatchedNote.textContent = seasonData.unmatched > 0
    ? `${seasonData.unmatched} goal${seasonData.unmatched === 1 ? '' : 's'} in the Goals Log couldn't be matched to a player in this table (the scorer's name doesn't match a stats row), so ${seasonData.unmatched === 1 ? 'it is' : 'they are'} left out of PPG, SHG, GWG and ENG.` : '';

  // Team totals, pinned under each table (they sit outside the sortable rows, so sorting never moves them).
  // GP here is the number of games these totals cover; adding up each player's GP would double-count.
  const skFoot = document.getElementById('p_seasonFoot');
  if (skList.length === 0) skFoot.innerHTML = '';
  else {
    const t = skList.reduce((a, p) => { a.goals += p.goals; a.assists += p.assists; a.ppg += p.ppg; a.shg += p.shg; a.gwg += p.gwg; a.eng += p.eng; a.sog += p.sog; a.pim += p.pim; a.fow += p.fow; a.fol += p.fol; return a; },
      { goals: 0, assists: 0, ppg: 0, shg: 0, gwg: 0, eng: 0, sog: 0, pim: 0, fow: 0, fol: 0 });
    skFoot.innerHTML = `<tr><td style="text-align:left;">Team Totals</td><td></td><td>${seasonData.games}</td>` +
      `<td>${t.goals}</td><td>${t.assists}</td><td>${t.goals + t.assists}</td><td>—</td><td>${t.ppg}</td><td>${t.shg}</td><td>${t.gwg}</td><td>${t.eng}</td><td>${t.sog}</td><td>${t.pim}</td>` +
      `<td>${t.fow}</td><td>${t.fol}</td><td>${foPct(t.fow, t.fol)}</td></tr>`;
  }

  const gkBase = (a, b) => b.secs - a.secs || a.name.localeCompare(b.name);
  const gkList = sortRows(seasonData.goalies, sortState.seasonGoalie, GOALIE_SEASON_COLS, gkBase);
  gkBody.innerHTML = gkList.length === 0
    ? '<tr><td colspan="8" style="color:var(--sub);">No goalie stats saved for this filter yet.</td></tr>'
    : gkList.map(g => `
    <tr>
      <td style="text-align:left;">${g.name}</td>
      <td>${g.gp}</td><td>${fmtClock(g.secs)}</td><td>${g.ga}</td><td>${fmtGaa(g.ga, g.secs)}</td>
      <td>${g.shots}</td><td>${g.saves}</td><td>${fmtSvPct(g.saves, g.shots)}</td>
    </tr>`).join('');

  const gkFoot = document.getElementById('p_seasonGoalieFoot');
  if (gkList.length === 0) gkFoot.innerHTML = '';
  else {
    const t = gkList.reduce((a, g) => { a.secs += g.secs; a.ga += g.ga; a.shots += g.shots; a.saves += g.saves; return a; }, { secs: 0, ga: 0, shots: 0, saves: 0 });
    gkFoot.innerHTML = `<tr><td style="text-align:left;">Team Totals</td><td>${seasonData.games}</td><td>${fmtClock(t.secs)}</td>` +
      `<td>${t.ga}</td><td>${fmtGaa(t.ga, t.secs)}</td><td>${t.shots}</td><td>${t.saves}</td><td>${fmtSvPct(t.saves, t.shots)}</td></tr>`;
  }
}
document.getElementById('p_seasonTypeFilter').addEventListener('change', renderSeasonPlayerTotals);
wireSortHeaders('p_statsTable', sortState.skater, SKATER_COLS, () => renderSkaterRows(readSkaterRowsFromTable()));
wireSortHeaders('p_goalieTable', sortState.goalie, GOALIE_GAME_COLS, () => renderGoalieRows(readGoalieRowsFromTable()));
wireSortHeaders('p_seasonTable', sortState.seasonSkater, SKATER_COLS, paintSeasonTables);
wireSortHeaders('p_seasonGoalieTable', sortState.seasonGoalie, GOALIE_SEASON_COLS, paintSeasonTables);

/* ===================== GOALS LOG TAB ===================== */
function goalsFilteredGames() {
  const filter = document.getElementById('g_typeFilter').value;
  return filter === 'All' ? games : games.filter(g => (g.gametype || 'Regular Season') === filter);
}
async function populateGoalsGameSelect() {
  const sel = document.getElementById('g_gameSelect');
  const sorted = [...goalsFilteredGames()].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (sorted.length === 0) { sel.innerHTML = '<option value="">No games logged for this filter</option>'; await renderGoalsForSelectedGame(); return; }
  sel.innerHTML = sorted.map(g => `<option value="${g.id}">${fmtDate(g.date)} — ${g.venue === 'Home' ? 'vs' : '@'} ${g.opponent} (${g.gf}-${g.ga})</option>`).join('');
  await renderGoalsForSelectedGame();
}
document.getElementById('g_gameSelect').addEventListener('change', renderGoalsForSelectedGame);
document.getElementById('g_refreshGames').addEventListener('click', populateGoalsGameSelect);
document.getElementById('g_typeFilter').addEventListener('change', async () => { await populateGoalsGameSelect(); await renderSeasonGoalsBreakdown(); });
function currentGoalsGameId() { return document.getElementById('g_gameSelect').value; }

async function renderGoalsForSelectedGame() {
  const gid = currentGoalsGameId();
  const body = document.getElementById('g_goalsBody');
  if (!gid) { body.innerHTML = '<tr><td colspan="8" style="color:var(--sub);">Select a game.</td></tr>'; return; }
  const rows = await api('/api/goals/' + gid);
  if (rows.length === 0) { body.innerHTML = '<tr><td colspan="8" style="color:var(--sub);">No goals logged for this game yet.</td></tr>'; return; }
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${r.period}</td><td>${r.time || ''}</td><td>${r.team === 'OTT' ? "67's" : 'Opp'}</td><td>${r.strength}</td>
      <td>${r.scorer || ''}</td><td>${r.assists || ''}</td><td>${(r.notes || '').replace(/</g, '&lt;')}</td>
      <td class="row-del" onclick="deleteGoal(${r.id})">✕</td>
    </tr>`).join('');
}
window.deleteGoal = async function (id) {
  await api('/api/goals/entry/' + id, { method: 'DELETE' });
  await renderGoalsForSelectedGame();
  await renderSeasonGoalsBreakdown();
};
document.getElementById('goalForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const gid = currentGoalsGameId();
  if (!gid) { alert('Select a game first.'); return; }
  const entry = {
    period: document.getElementById('g_period').value,
    time: document.getElementById('g_time').value.trim(),
    team: document.getElementById('g_team').value,
    strength: document.getElementById('g_strength').value,
    scorer: document.getElementById('g_scorer').value.trim(),
    assists: document.getElementById('g_assists').value.trim(),
    notes: document.getElementById('g_notes').value.trim()
  };
  await api('/api/goals/' + gid, { method: 'POST', body: JSON.stringify(entry) });
  document.getElementById('goalForm').reset();
  await renderGoalsForSelectedGame();
  await renderSeasonGoalsBreakdown();
});
async function renderSeasonGoalsBreakdown() {
  const filter = document.getElementById('g_typeFilter').value;
  const counts = await api('/api/goals-season-breakdown?gametype=' + encodeURIComponent(filter));
  const wrap = document.getElementById('g_seasonAgg');
  wrap.style.gridTemplateColumns = 'repeat(5, 1fr)';
  const card = (v, l) => `<div class="agg-card"><div class="val">${v}</div><div class="lbl">${l}</div></div>`;
  wrap.innerHTML =
    card(counts.OTT.EV, "67's EV Goals") + card(counts.OTT.PP, "67's PP Goals") + card(counts.OTT.SH, "67's SH Goals") +
    card(counts.OTT.EN, "67's EN Goals") + card(counts.OTT.PS, "67's Penalty Shots") +
    card(counts.OPP.EV, 'Opp EV Goals') + card(counts.OPP.PP, 'Opp PP Goals') + card(counts.OPP.SH, 'Opp SH Goals') +
    card(counts.OPP.EN, 'Opp EN Goals') + card(counts.OPP.PS, 'Opp Penalty Shots');
}

/* ===================== INIT ===================== */
(async function init() {
  try {
    await loadGames();
    renderLogTab();
    await populatePlayerGameSelect();
    await renderSeasonPlayerTotals();
    await populateGoalsGameSelect();
    await renderSeasonGoalsBreakdown();
  } catch (e) {
    document.getElementById('statusText').textContent = 'Could not reach the server — check that it is running.';
    console.error(e);
  }
})();

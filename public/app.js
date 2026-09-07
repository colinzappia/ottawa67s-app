const API = '';

let games = [];
let editingId = null;
let lastParsedTeams = {};

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
  });
});

/* ===================== PHOTO UPLOAD ===================== */
async function loadPhotos() {
  try {
    const photos = await api('/api/photos');
    applyPhoto('away', photos.away);
    applyPhoto('home', photos.home);
    applyLogo(photos.logo);
  } catch (e) { /* ignore on first load */ }
}
function applyPhoto(team, dataurl) {
  const preview = document.getElementById(team + 'PhotoPreview');
  if (dataurl) { preview.src = dataurl; preview.classList.add('has-img'); }
  else { preview.src = ''; preview.classList.remove('has-img'); }
}
function applyLogo(dataurl) {
  const preview = document.getElementById('logoPhotoPreview');
  if (dataurl) { preview.src = dataurl; preview.classList.add('has-img'); }
  else { preview.src = ''; preview.classList.remove('has-img'); }
}
function wirePhotoUpload(team) {
  const input = document.getElementById(team + 'PhotoInput');
  const removeBtn = document.getElementById(team + 'PhotoRemove');
  input.addEventListener('change', function () {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
      const dataUrl = e.target.result;
      applyPhoto(team, dataUrl);
      try { await api('/api/photos/' + team, { method: 'PUT', body: JSON.stringify({ dataurl: dataUrl }) }); }
      catch (err) { alert('Could not save photo to the server.'); }
    };
    reader.readAsDataURL(file);
  });
  removeBtn.addEventListener('click', async function () {
    applyPhoto(team, null);
    input.value = '';
    try { await api('/api/photos/' + team, { method: 'DELETE' }); } catch (e) {}
  });
}
wirePhotoUpload('away');
wirePhotoUpload('home');

function wireLogoUpload() {
  const input = document.getElementById('logoPhotoInput');
  const removeBtn = document.getElementById('logoPhotoRemove');
  input.addEventListener('change', function () {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
      const dataUrl = e.target.result;
      applyLogo(dataUrl);
      try { await api('/api/photos/logo', { method: 'PUT', body: JSON.stringify({ dataurl: dataUrl }) }); }
      catch (err) { alert('Could not save logo to the server.'); }
    };
    reader.readAsDataURL(file);
  });
  removeBtn.addEventListener('click', async function () {
    applyLogo(null);
    input.value = '';
    try { await api('/api/photos/logo', { method: 'DELETE' }); } catch (e) {}
  });
}
wireLogoUpload();

/* ===================== GAME LOG & AGGREGATES ===================== */
function filteredGames() {
  const filter = document.getElementById('logFilter').value;
  if (filter === 'All') return games;
  return games.filter(g => (g.gametype || 'Regular Season') === filter);
}
function computeAggregates() {
  const list = filteredGames();
  const agg = { gp: list.length, w: 0, l: 0, otl: 0, pts: 0, gf: 0, ga: 0, sf: 0, sa: 0,
    ppg: 0, ppo: 0, pk_against: 0, pk_ga: 0, shgf: 0, shga: 0, engf: 0, enga: 0,
    sogf: 0, soga: 0, psgf: 0, psga: 0 };
  list.forEach(g => {
    if (g.result === 'W') { agg.w++; agg.pts += 2; }
    else if (g.result === 'L') { agg.l++; }
    else if (g.result === 'OTL') { agg.otl++; agg.pts += 1; }
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
function renderAggregates() {
  const a = computeAggregates();
  const ppPct = a.ppo > 0 ? ((a.ppg / a.ppo) * 100).toFixed(1) + '%' : '—';
  const pkPct = a.pk_against > 0 ? (((a.pk_against - a.pk_ga) / a.pk_against) * 100).toFixed(1) + '%' : '—';
  const diff = a.gf - a.ga; const diffStr = (diff > 0 ? '+' : '') + diff;
  const gpg = a.gp > 0 ? (a.gf / a.gp).toFixed(2) : '0.00';
  const gapg = a.gp > 0 ? (a.ga / a.gp).toFixed(2) : '0.00';
  document.getElementById('aggGrid').innerHTML = `
    <div class="agg-card"><div class="val">${a.gp}</div><div class="lbl">Games</div></div>
    <div class="agg-card"><div class="val">${a.w}-${a.l}-${a.otl}</div><div class="lbl">Record</div></div>
    <div class="agg-card"><div class="val">${a.pts}</div><div class="lbl">Points</div></div>
    <div class="agg-card"><div class="val">${a.gf}</div><div class="lbl">Goals For</div></div>
    <div class="agg-card"><div class="val">${a.ga}</div><div class="lbl">Goals Against</div></div>
    <div class="agg-card"><div class="val">${diffStr}</div><div class="lbl">Goal Diff</div></div>`;
  document.getElementById('aggGrid2').innerHTML = `
    <div class="agg-card"><div class="val">${gpg}</div><div class="lbl">Goals/Game</div></div>
    <div class="agg-card"><div class="val">${gapg}</div><div class="lbl">GA/Game</div></div>
    <div class="agg-card"><div class="val">${ppPct}</div><div class="lbl">Power Play %</div></div>
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
      if (i < lines.length && lines[i] === '*') { i++; }
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

/* ===================== PLAYER STATS TAB ===================== */
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
  if (!gid) { renderSkaterRows([]); renderGoalieRows([]); return; }
  const data = await api('/api/player-stats/' + gid);
  renderSkaterRows(data.skaters || []);
  renderGoalieRows(data.goalies || []);
}
function foPct(fow, fol) { const tot = fow + fol; return tot > 0 ? ((fow / tot) * 100).toFixed(1) + '%' : '—'; }

function renderSkaterRows(rows) {
  const body = document.getElementById('p_statsBody');
  if (rows.length === 0) { body.innerHTML = '<tr><td colspan="13" style="color:var(--sub);">No skater stats yet. Paste a gamesheet above and Parse, or add rows manually.</td></tr>'; return; }
  body.innerHTML = rows.map((r, i) => `
    <tr data-idx="${i}">
      <td contenteditable="true" data-field="name">${r.name || ''}</td>
      <td contenteditable="true" data-field="pos">${r.pos || ''}</td>
      <td contenteditable="true" data-field="number">${r.number || ''}</td>
      <td contenteditable="true" data-field="goals">${r.goals || 0}</td>
      <td contenteditable="true" data-field="assists">${r.assists || 0}</td>
      <td contenteditable="true" data-field="points">${r.points || 0}</td>
      <td contenteditable="true" data-field="plusMinus">${r.plusMinus || 0}</td>
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
  body.innerHTML = rows.map((r, i) => {
    const svpct = (r.shots > 0) ? ((r.saves / r.shots) * 100).toFixed(1) + '%' : '—';
    return `
    <tr data-idx="${i}">
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
    rows.push({ name, ga, min, shots, saves, pim });
  });
  return rows;
}
window.deleteGoalieRow = function (idx) { const rows = readGoalieRowsFromTable(); rows.splice(idx, 1); renderGoalieRows(rows); };
document.getElementById('p_addGoalieRow').addEventListener('click', () => {
  const rows = readGoalieRowsFromTable();
  rows.push({ name: 'New Goalie', ga: 0, min: '', shots: 0, saves: 0, pim: 0 });
  renderGoalieRows(rows);
});
document.getElementById('p_parseBtn').addEventListener('click', () => {
  const text = document.getElementById('p_pasteArea').value;
  if (!text.trim()) { alert('Paste some gamesheet text first.'); return; }
  const teams = parseGamesheetText(text);
  const teamNames = Object.keys(teams);
  if (teamNames.length === 0) { alert('Couldn\'t find any recognizable team sections. Make sure you included the "Skaters" and "Goalies" headers from the gamesheet.'); return; }
  lastParsedTeams = teams;
  const pick = document.getElementById('p_teamPick');
  pick.innerHTML = teamNames.map(t => `<option value="${t}">${t} (${teams[t].skaters.length} skaters)</option>`).join('');
  const preferred = teamNames.find(t => /67/.test(t));
  if (preferred) pick.value = preferred;
  pick.style.display = 'inline-block';
  document.getElementById('p_loadTeamBtn').style.display = 'inline-block';
});
document.getElementById('p_loadTeamBtn').addEventListener('click', () => {
  const teamName = document.getElementById('p_teamPick').value;
  const data = lastParsedTeams[teamName];
  if (!data) return;
  renderSkaterRows(data.skaters);
  renderGoalieRows(data.goalies);
});
document.getElementById('p_saveGameStats').addEventListener('click', async () => {
  const gid = currentPlayerGameId();
  if (!gid) { alert('Select or add a game first (in the Game Log tab).'); return; }
  const payload = { skaters: readSkaterRowsFromTable(), goalies: readGoalieRowsFromTable() };
  await api('/api/player-stats/' + gid, { method: 'PUT', body: JSON.stringify(payload) });
  await renderSeasonPlayerTotals();
  alert('Saved stats for this game.');
});
async function renderSeasonPlayerTotals() {
  const arr = await api('/api/player-stats-season');
  const body = document.getElementById('p_seasonBody');
  if (arr.length === 0) { body.innerHTML = '<tr><td colspan="11" style="color:var(--sub);">No player stats saved yet.</td></tr>'; return; }
  body.innerHTML = arr.map(p => `
    <tr>
      <td style="text-align:left;">${p.name}</td>
      <td>${p.gp}</td><td>${p.goals}</td><td>${p.assists}</td><td>${p.points}</td>
      <td>${p.plusMinus > 0 ? '+' : ''}${p.plusMinus}</td><td>${p.sog}</td><td>${p.pim}</td>
      <td>${p.fow}</td><td>${p.fol}</td><td>${foPct(p.fow, p.fol)}</td>
    </tr>`).join('');
}

/* ===================== GOALS LOG TAB ===================== */
async function populateGoalsGameSelect() {
  const sel = document.getElementById('g_gameSelect');
  const sorted = [...games].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (sorted.length === 0) { sel.innerHTML = '<option value="">No games logged yet</option>'; return; }
  sel.innerHTML = sorted.map(g => `<option value="${g.id}">${fmtDate(g.date)} — ${g.venue === 'Home' ? 'vs' : '@'} ${g.opponent} (${g.gf}-${g.ga})</option>`).join('');
  await renderGoalsForSelectedGame();
}
document.getElementById('g_gameSelect').addEventListener('change', renderGoalsForSelectedGame);
document.getElementById('g_refreshGames').addEventListener('click', populateGoalsGameSelect);
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
  const counts = await api('/api/goals-season-breakdown');
  const wrap = document.getElementById('g_seasonAgg');
  wrap.innerHTML = `
    <div class="agg-card"><div class="val">${counts.OTT.EV}</div><div class="lbl">67's EV Goals</div></div>
    <div class="agg-card"><div class="val">${counts.OTT.PP}</div><div class="lbl">67's PP Goals</div></div>
    <div class="agg-card"><div class="val">${counts.OTT.SH}</div><div class="lbl">67's SH Goals</div></div>
    <div class="agg-card"><div class="val">${counts.OPP.EV}</div><div class="lbl">Opp EV Goals</div></div>
    <div class="agg-card"><div class="val">${counts.OPP.PP}</div><div class="lbl">Opp PP Goals</div></div>
    <div class="agg-card"><div class="val">${counts.OPP.SH}</div><div class="lbl">Opp SH Goals</div></div>`;
}

/* ===================== INIT ===================== */
(async function init() {
  try {
    await loadGames();
    await loadPhotos();
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

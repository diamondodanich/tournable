const STORAGE_KEY = 'pitchpro_tournament_v1';

let state = {
  tournamentName: 'Кубок Чемпионов 2026',
  numRounds: 2,
  teams: [],
  fixtures: [],
  generated: false,
  prevRanks: {},
};

let isReadOnly = false;

function saveState() {
  if (isReadOnly) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.warn(e); }
}
function loadState() {
  const hash = location.hash;
  if (hash.startsWith('#share=')) {
    try {
      const compressed = hash.substring(7);
      const json = LZString.decompressFromEncodedURIComponent(compressed);
      if (json) {
        const loaded = JSON.parse(json);
        state = { ...state, ...loaded };
        isReadOnly = true;
        document.body.classList.add('read-only');
        document.getElementById('live-badge').classList.add('read-only');
        document.getElementById('live-text').textContent = 'РЕЖИМ ПРОСМОТРА';
        return;
      }
    } catch (e) { console.warn('Bad share link:', e); }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const loaded = JSON.parse(raw);
      state = { ...state, ...loaded };
    }
  } catch (e) { console.warn(e); }
}

function uid() { return Math.random().toString(36).slice(2, 10); }
function teamById(id) { return state.teams.find(t => t.id === id) || { name: 'Неизвестно' }; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

function showToast(message, type = 'info') {
  const wrap = document.getElementById('toast-wrap');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3000);
}

function generateRoundRobin(teams) {
  let workingTeams = teams.slice();
  const isOdd = workingTeams.length % 2 === 1;
  if (isOdd) workingTeams.push(null);

  const n = workingTeams.length;
  const rounds = n - 1;
  const half = n / 2;
  const result = [];

  const fixed = workingTeams[0];
  let rotating = workingTeams.slice(1);

  for (let r = 0; r < rounds; r++) {
    const roundMatches = [];
    const arrangement = [fixed, ...rotating];
    for (let i = 0; i < half; i++) {
      const home = arrangement[i];
      const away = arrangement[n - 1 - i];
      if (r % 2 === 1 && i === 0) {
        roundMatches.push([away, home]);
      } else {
        roundMatches.push([home, away]);
      }
    }
    result.push(roundMatches);
    rotating.unshift(rotating.pop());
  }
  return result;
}

function generateSchedule() {
  if (state.teams.length < 2) {
    showToast('Нужно минимум 2 команды', 'error');
    return;
  }
  if (state.generated && state.fixtures.some(f => f.played)) {
    if (!confirm('Расписание уже создано и есть сыгранные матчи. Перегенерировать и потерять все результаты?')) return;
  }

  state.fixtures = [];
  const teamIds = state.teams.map(t => t.id);
  const baseRounds = generateRoundRobin(teamIds);
  let matchdayCounter = 0;

  for (let cycle = 0; cycle < state.numRounds; cycle++) {
    baseRounds.forEach((round, ri) => {
      matchdayCounter++;
      round.forEach(([a, b]) => {
        let home = a, away = b;
        if (cycle % 2 === 1) { home = b; away = a; }
        const isBye = (home === null || away === null);
        state.fixtures.push({
          id: uid(),
          matchday: matchdayCounter,
          round: cycle + 1,
          cycleRound: ri + 1,
          homeId: home,
          awayId: away,
          homeScore: null,
          awayScore: null,
          played: false,
          isBye: isBye,
          scorers: [],
        });
      });
    });
  }

  state.generated = true;
  saveState();
  renderAll();
  switchTab('fixtures');
  showToast('Расписание успешно создано!', 'success');
}

function computeStandings() {
  const rows = state.teams.map(team => ({
    teamId: team.id,
    name: team.name,
    GP: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0,
    form: [],
  }));
  const idx = id => rows.findIndex(r => r.teamId === id);

  state.fixtures
    .filter(f => f.played && !f.isBye)
    .sort((a, b) => a.matchday - b.matchday)
    .forEach(f => {
      const h = idx(f.homeId), a = idx(f.awayId);
      if (h < 0 || a < 0) return;
      rows[h].GP++; rows[a].GP++;
      rows[h].GF += f.homeScore; rows[h].GA += f.awayScore;
      rows[a].GF += f.awayScore; rows[a].GA += f.homeScore;
      if (f.homeScore > f.awayScore) {
        rows[h].W++; rows[a].L++;
        rows[h].Pts += 3;
        rows[h].form.push('W'); rows[a].form.push('L');
      } else if (f.homeScore < f.awayScore) {
        rows[a].W++; rows[h].L++;
        rows[a].Pts += 3;
        rows[a].form.push('W'); rows[h].form.push('L');
      } else {
        rows[h].D++; rows[a].D++;
        rows[h].Pts++; rows[a].Pts++;
        rows[h].form.push('D'); rows[a].form.push('D');
      }
    });

  rows.forEach(r => { r.GD = r.GF - r.GA; });
  rows.sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.name.localeCompare(b.name, 'ru'));
  return rows;
}

function renderHeader() {
  const name = (state.tournamentName || 'PITCH PRO').toUpperCase();
  document.getElementById('header-tournament-name').textContent = name;
  document.title = `${state.tournamentName || 'Pitch Pro'} — Турнирный менеджер`;
}

function renderSetup() {
  document.getElementById('tournament-name').value = state.tournamentName;
  document.getElementById('num-rounds').value = state.numRounds;
  document.getElementById('team-count').textContent = state.teams.length;

  const chipRow = document.getElementById('team-chips');
  if (state.teams.length === 0) {
    chipRow.classList.add('empty');
    chipRow.innerHTML = '';
  } else {
    chipRow.classList.remove('empty');
    chipRow.innerHTML = state.teams.map(t =>
      `<span class="chip">${escapeHtml(t.name)}<button class="chip-remove" onclick="removeTeam('${t.id}')" title="Удалить">×</button></span>`
    ).join('');
  }
  document.getElementById('generate-btn').disabled = state.teams.length < 2;
}

function renderStatsBar() {
  const bar = document.getElementById('stats-bar');
  if (!state.generated) { bar.style.display = 'none'; return; }
  bar.style.display = 'grid';
  const realFixtures = state.fixtures.filter(f => !f.isBye);
  const played = realFixtures.filter(f => f.played);
  const goals = played.reduce((s, f) => s + (f.homeScore || 0) + (f.awayScore || 0), 0);
  document.getElementById('stat-teams').textContent = state.teams.length;
  document.getElementById('stat-played').textContent = played.length;
  document.getElementById('stat-total').textContent = realFixtures.length;
  document.getElementById('stat-goals').textContent = goals;
}

function renderFixtures() {
  const container = document.getElementById('fixtures-content');
  if (!state.generated || state.fixtures.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚽</div>
        <div class="empty-state-title">Матчей пока нет</div>
        <div class="empty-state-sub">Добавьте команды и сгенерируйте расписание, чтобы увидеть матчи.</div>
      </div>`;
    document.getElementById('fixtures-count').textContent = '0';
    document.getElementById('fixtures-progress').textContent = 'Сыграно 0 из 0';
    return;
  }

  const realFixtures = state.fixtures.filter(f => !f.isBye);
  const playedCount = realFixtures.filter(f => f.played).length;
  document.getElementById('fixtures-count').textContent = realFixtures.length;
  document.getElementById('fixtures-progress').textContent = `Сыграно ${playedCount} из ${realFixtures.length}`;

  const byMatchday = {};
  state.fixtures.forEach(f => {
    if (!byMatchday[f.matchday]) byMatchday[f.matchday] = [];
    byMatchday[f.matchday].push(f);
  });

  let html = '';
  Object.keys(byMatchday).sort((a, b) => +a - +b).forEach(md => {
    const fixtures = byMatchday[md];
    const cycle = fixtures[0].round;
    html += `
      <div class="matchday-block">
        <div class="matchday-header">
          <div class="matchday-num">Тур ${md}</div>
          <div class="matchday-line"></div>
          <div class="matchday-meta">Круг ${cycle} из ${state.numRounds}</div>
        </div>
        <div class="fixture-grid">
          ${fixtures.map(f => renderFixtureCard(f)).join('')}
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

function renderFixtureCard(f) {
  if (f.isBye) {
    const realTeam = teamById(f.homeId === null ? f.awayId : f.homeId).name;
    return `
      <div class="fixture bye">
        <div class="fixture-status pending">ПРОПУСК</div>
        <div class="fixture-teams">
          <div class="fixture-team-name">${escapeHtml(realTeam)}</div>
          <div class="score-divider" style="font-size:13px; color:var(--text-3);">ОТДЫХАЕТ</div>
          <div class="fixture-team-name away" style="color:var(--text-3);">— ПРОПУСК —</div>
        </div>
      </div>`;
  }

  const home = teamById(f.homeId);
  const away = teamById(f.awayId);
  const status = f.played
    ? `<div class="fixture-status done">✓ Сыгран</div>`
    : `<div class="fixture-status pending">Не сыгран</div>`;

  const homeScore = f.homeScore !== null ? f.homeScore : '';
  const awayScore = f.awayScore !== null ? f.awayScore : '';

  const homeScorers = f.scorers.filter(s => s.teamId === f.homeId);
  const awayScorers = f.scorers.filter(s => s.teamId === f.awayId);

  return `
    <div class="fixture ${f.played ? 'completed' : ''}" data-fid="${f.id}">
      ${status}
      <div class="fixture-teams">
        <div class="fixture-team-name">${escapeHtml(home.name)}</div>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="number" min="0" max="99" class="score-input" data-side="home" value="${homeScore}" oninput="onScoreInput(event, '${f.id}')">
          <div class="score-divider">–</div>
          <input type="number" min="0" max="99" class="score-input" data-side="away" value="${awayScore}" oninput="onScoreInput(event, '${f.id}')">
        </div>
        <div class="fixture-team-name away">${escapeHtml(away.name)}</div>
      </div>

      <div class="scorers-section">
        <div class="scorers-side">
          <div class="scorers-label">⚽ Голы — ${escapeHtml(home.name)}</div>
          ${homeScorers.map((s, i) => renderScorerInput(f.id, f.homeId, i, s.playerName)).join('')}
          <button class="add-scorer-btn" onclick="addScorer('${f.id}', '${f.homeId}')">+ Добавить автора гола</button>
        </div>
        <div class="scorers-side">
          <div class="scorers-label">⚽ Голы — ${escapeHtml(away.name)}</div>
          ${awayScorers.map((s, i) => renderScorerInput(f.id, f.awayId, i, s.playerName)).join('')}
          <button class="add-scorer-btn" onclick="addScorer('${f.id}', '${f.awayId}')">+ Добавить автора гола</button>
        </div>
      </div>

      <div class="fixture-actions">
        <button class="save-result" onclick="saveResult('${f.id}')">Сохранить результат</button>
      </div>
    </div>`;
}

function renderScorerInput(fixtureId, teamId, scorerIndex, value) {
  const sid = `s_${fixtureId}_${teamId}_${scorerIndex}`;
  return `
    <div class="scorer-input-wrap">
      <input type="text" class="scorer-input" id="${sid}"
             placeholder="Имя игрока…"
             value="${escapeHtml(value || '')}"
             oninput="onScorerInput(event, '${fixtureId}', '${teamId}', ${scorerIndex})"
             onkeydown="onScorerKey(event, '${fixtureId}', '${teamId}', ${scorerIndex})"
             onblur="onScorerBlur(event, '${fixtureId}', '${teamId}', ${scorerIndex})"
             onfocus="showAutocomplete(this, '${teamId}')"
             autocomplete="off">
      <button class="scorer-remove" onclick="removeScorer('${fixtureId}', '${teamId}', ${scorerIndex})">×</button>
    </div>`;
}

function renderStandings() {
  const wrap = document.getElementById('standings-table-wrap');
  if (!state.generated || state.teams.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <div class="empty-state-title">Таблица пока пуста</div>
        <div class="empty-state-sub">Сгенерируйте расписание, чтобы увидеть турнирную таблицу.</div>
      </div>`;
    return;
  }

  const rows = computeStandings();
  const newRanks = {};
  rows.forEach((r, i) => { newRanks[r.teamId] = i + 1; });

  let html = `
    <div class="table-wrap">
      <table class="standings">
        <thead>
          <tr>
            <th>#</th>
            <th>Команда</th>
            <th title="Игр">И</th>
            <th title="Побед">В</th>
            <th title="Ничьих">Н</th>
            <th title="Поражений">П</th>
            <th>Форма</th>
            <th title="Забитые мячи">ЗМ</th>
            <th title="Пропущенные мячи">ПМ</th>
            <th title="Разница мячей">РМ</th>
            <th title="Очки">О</th>
          </tr>
        </thead>
        <tbody>`;

  rows.forEach((r, i) => {
    const rank = i + 1;
    const prev = state.prevRanks[r.teamId];
    let change = '';
    if (prev != null && prev !== rank) {
      const dir = rank < prev ? 'up' : 'down';
      const arrow = rank < prev ? '↑' : '↓';
      const diff = Math.abs(prev - rank);
      change = `<span class="rank-change ${dir}">${arrow}${diff}</span>`;
    }

    const last5 = r.form.slice(-5);
    const formHtml = '<div class="form-cell">' +
      Array.from({ length: 5 }).map((_, idx) => {
        const result = last5[idx] || null;
        if (!result) return '<span class="form-square empty">·</span>';
        const label = result === 'W' ? 'В' : result === 'D' ? 'Н' : 'П';
        return `<span class="form-square ${result}">${label}</span>`;
      }).join('') + '</div>';

    const gdClass = r.GD > 0 ? 'positive' : (r.GD < 0 ? 'negative' : '');
    const gdDisplay = r.GD > 0 ? `+${r.GD}` : `${r.GD}`;

    html += `
      <tr class="rank-${rank}">
        <td class="rank-cell">${rank}${change}</td>
        <td class="team-cell">${escapeHtml(r.name)}</td>
        <td>${r.GP}</td>
        <td>${r.W}</td>
        <td>${r.D}</td>
        <td>${r.L}</td>
        <td>${formHtml}</td>
        <td>${r.GF}</td>
        <td>${r.GA}</td>
        <td class="col-gd ${gdClass}">${gdDisplay}</td>
        <td class="col-pts">${r.Pts}</td>
      </tr>`;
  });

  html += '</tbody></table></div>';
  wrap.innerHTML = html;
  state.prevRanks = newRanks;
}

function renderMatrix() {
  const wrap = document.getElementById('matrix-table-wrap');
  if (!state.generated || state.teams.length < 2) {
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔀</div>
        <div class="empty-state-title">Матрица недоступна</div>
        <div class="empty-state-sub">Нужно минимум 2 команды для отображения очных встреч.</div>
      </div>`;
    return;
  }

  const teams = state.teams;
  let html = '<div class="table-wrap"><table class="matrix"><thead><tr>';
  html += '<th class="corner"></th>';
  teams.forEach(t => { html += `<th>${escapeHtml(t.name)}</th>`; });
  html += '</tr></thead><tbody>';

  teams.forEach(rowTeam => {
    html += `<tr><th class="row-header">${escapeHtml(rowTeam.name)}</th>`;
    teams.forEach(colTeam => {
      if (rowTeam.id === colTeam.id) {
        html += `<td class="diagonal">—</td>`;
      } else {
        const matches = state.fixtures.filter(f =>
          f.played && !f.isBye && f.homeId === rowTeam.id && f.awayId === colTeam.id
        );
        if (matches.length === 0) {
          html += `<td class="cell-pending">—</td>`;
        } else if (matches.length === 1) {
          const m = matches[0];
          const cls = m.homeScore > m.awayScore ? 'cell-W' : m.homeScore < m.awayScore ? 'cell-L' : 'cell-D';
          html += `<td class="${cls}">${m.homeScore}–${m.awayScore}</td>`;
        } else {
          const cells = matches.map(m => {
            const cls = m.homeScore > m.awayScore ? 'cell-W' : m.homeScore < m.awayScore ? 'cell-L' : 'cell-D';
            return `<span class="${cls}" style="display:inline-block;padding:2px 5px;margin:1px;border-radius:3px;">${m.homeScore}–${m.awayScore}</span>`;
          }).join('<br>');
          html += `<td class="cell-multi">${cells}</td>`;
        }
      }
    });
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  wrap.innerHTML = html;
}

function renderScorers() {
  const wrap = document.getElementById('scorers-table-wrap');
  const map = new Map();
  state.fixtures.forEach(f => {
    if (!f.played || f.isBye) return;
    f.scorers.forEach(s => {
      const name = (s.playerName || '').trim();
      if (!name) return;
      const key = `${s.teamId}|${name.toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, { player: name, teamName: teamById(s.teamId).name, goals: 0 });
      }
      map.get(key).goals++;
    });
  });

  const list = [...map.values()].sort((a, b) => b.goals - a.goals || a.player.localeCompare(b.player, 'ru'));

  if (list.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚽</div>
        <div class="empty-state-title">Голов пока не забито</div>
        <div class="empty-state-sub">Указывайте авторов голов при вводе результатов матчей.</div>
      </div>`;
    return;
  }

  let html = `
    <div class="table-wrap">
      <table class="scorers">
        <thead>
          <tr>
            <th style="width:60px;">Место</th>
            <th>Игрок</th>
            <th>Команда</th>
            <th style="width:80px;">Голы</th>
          </tr>
        </thead>
        <tbody>`;

  list.forEach((p, i) => {
    const rank = i + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
    html += `
      <tr>
        <td><span class="medal">${medal}</span> ${medal ? '' : rank}</td>
        <td class="team-cell">${escapeHtml(p.player)}</td>
        <td class="team-cell" style="color:var(--text-2); font-weight:500;">${escapeHtml(p.teamName)}</td>
        <td class="goal-count">${p.goals}</td>
      </tr>`;
  });

  html += '</tbody></table></div>';
  wrap.innerHTML = html;
}

function renderAll() {
  renderHeader();
  renderSetup();
  renderStatsBar();
  renderFixtures();
  renderStandings();
  renderMatrix();
  renderScorers();
}

function addTeam() {
  const input = document.getElementById('team-input');
  const name = input.value.trim();
  if (!name) return;
  if (state.teams.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    showToast('Такая команда уже существует', 'error');
    return;
  }
  state.teams.push({ id: uid(), name });
  input.value = '';
  if (state.generated && !state.fixtures.some(f => f.played)) {
    state.fixtures = [];
    state.generated = false;
  }
  saveState();
  renderAll();
  input.focus();
}

function removeTeam(teamId) {
  if (state.generated && state.fixtures.some(f => f.played)) {
    if (!confirm('Удаление команды сбросит всё расписание и результаты. Продолжить?')) return;
    state.fixtures = [];
    state.generated = false;
  }
  state.teams = state.teams.filter(t => t.id !== teamId);
  if (state.fixtures.length && !state.fixtures.some(f => f.played)) {
    state.fixtures = [];
    state.generated = false;
  }
  saveState();
  renderAll();
}

function onScoreInput(e, fixtureId) {
  const fix = state.fixtures.find(f => f.id === fixtureId);
  if (!fix) return;
  const val = e.target.value === '' ? null : Math.max(0, Math.min(99, parseInt(e.target.value) || 0));
  if (e.target.dataset.side === 'home') fix.homeScore = val;
  else fix.awayScore = val;
}

function saveResult(fixtureId) {
  const fix = state.fixtures.find(f => f.id === fixtureId);
  if (!fix) return;
  if (fix.homeScore == null || fix.awayScore == null) {
    showToast('Введите оба счёта', 'error');
    return;
  }
  const homeScorers = fix.scorers.filter(s => s.teamId === fix.homeId).filter(s => s.playerName.trim()).length;
  const awayScorers = fix.scorers.filter(s => s.teamId === fix.awayId).filter(s => s.playerName.trim()).length;
  if (homeScorers > fix.homeScore || awayScorers > fix.awayScore) {
    if (!confirm('Указано больше авторов голов, чем забито. Сохранить всё равно?')) return;
  }
  fix.scorers = fix.scorers.filter(s => s.playerName.trim());
  fix.played = true;
  saveState();
  renderAll();
  showToast(`Результат сохранён: ${teamById(fix.homeId).name} ${fix.homeScore}–${fix.awayScore} ${teamById(fix.awayId).name}`, 'success');
}

function addScorer(fixtureId, teamId) {
  const fix = state.fixtures.find(f => f.id === fixtureId);
  if (!fix) return;
  fix.scorers.push({ teamId, playerName: '' });
  saveState();
  renderFixtures();
  const teamScorers = fix.scorers.filter(s => s.teamId === teamId);
  const idx = teamScorers.length - 1;
  setTimeout(() => {
    const el = document.getElementById(`s_${fixtureId}_${teamId}_${idx}`);
    if (el) el.focus();
  }, 50);
}

function removeScorer(fixtureId, teamId, scorerIndex) {
  const fix = state.fixtures.find(f => f.id === fixtureId);
  if (!fix) return;
  let count = -1;
  for (let i = 0; i < fix.scorers.length; i++) {
    if (fix.scorers[i].teamId === teamId) {
      count++;
      if (count === scorerIndex) {
        fix.scorers.splice(i, 1);
        break;
      }
    }
  }
  saveState();
  renderFixtures();
}

function onScorerInput(e, fixtureId, teamId, scorerIndex) {
  const fix = state.fixtures.find(f => f.id === fixtureId);
  if (!fix) return;
  let count = -1;
  for (let i = 0; i < fix.scorers.length; i++) {
    if (fix.scorers[i].teamId === teamId) {
      count++;
      if (count === scorerIndex) {
        fix.scorers[i].playerName = e.target.value;
        break;
      }
    }
  }
  showAutocomplete(e.target, teamId);
}

function onScorerBlur(e, fixtureId, teamId, scorerIndex) {
  setTimeout(() => {
    hideAutocomplete(e.target);
    saveState();
  }, 150);
}

function onScorerKey(e, fixtureId, teamId, scorerIndex) {
  const wrap = e.target.parentElement;
  const ac = wrap.querySelector('.autocomplete');
  if (!ac) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    return;
  }
  const items = [...ac.querySelectorAll('.autocomplete-item')];
  const highlighted = ac.querySelector('.highlighted');
  let idx = items.indexOf(highlighted);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    idx = Math.min(items.length - 1, idx + 1);
    items.forEach(it => it.classList.remove('highlighted'));
    if (items[idx]) items[idx].classList.add('highlighted');
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    idx = Math.max(0, idx - 1);
    items.forEach(it => it.classList.remove('highlighted'));
    if (items[idx]) items[idx].classList.add('highlighted');
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (highlighted) {
      e.target.value = highlighted.dataset.value;
      onScorerInput({ target: e.target }, fixtureId, teamId, scorerIndex);
      hideAutocomplete(e.target);
    } else {
      e.target.blur();
    }
  } else if (e.key === 'Escape') {
    hideAutocomplete(e.target);
  }
}

function getPlayerSuggestions(teamId, query) {
  const allNames = new Set();
  state.fixtures.forEach(f => {
    f.scorers.forEach(s => {
      if (s.teamId === teamId && s.playerName.trim()) {
        allNames.add(s.playerName.trim());
      }
    });
  });
  const q = (query || '').toLowerCase().trim();
  if (!q) return [...allNames].sort();
  return [...allNames]
    .filter(n => n.toLowerCase() !== q && n.toLowerCase().includes(q))
    .sort();
}

function showAutocomplete(inputEl, teamId) {
  if (isReadOnly) return;
  hideAutocomplete(inputEl);
  const query = inputEl.value;
  if (!query || query.length < 1) return;
  const suggestions = getPlayerSuggestions(teamId, query);
  if (suggestions.length === 0) return;
  const ac = document.createElement('div');
  ac.className = 'autocomplete';
  ac.innerHTML = suggestions.slice(0, 8).map(name =>
    `<div class="autocomplete-item" data-value="${escapeHtml(name)}" onmousedown="event.preventDefault(); selectAutocomplete(this)">${escapeHtml(name)}</div>`
  ).join('');
  inputEl.parentElement.appendChild(ac);
}

function hideAutocomplete(inputEl) {
  const ac = inputEl.parentElement.querySelector('.autocomplete');
  if (ac) ac.remove();
}

function selectAutocomplete(el) {
  const wrap = el.closest('.scorer-input-wrap');
  const input = wrap.querySelector('.scorer-input');
  input.value = el.dataset.value;
  const evt = new Event('input', { bubbles: true });
  input.dispatchEvent(evt);
  hideAutocomplete(input);
  saveState();
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.dataset.tab === name));
}

document.getElementById('tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (btn) switchTab(btn.dataset.tab);
});

async function exportPNG(elementId, filename) {
  const el = document.getElementById(elementId);
  if (!el || !el.querySelector('table')) {
    showToast('Нечего экспортировать', 'error');
    return;
  }
  showToast('Создаю изображение…');
  try {
    const canvas = await html2canvas(el, {
      backgroundColor: '#ffffff',
      scale: 2,
      logging: false,
    });
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${state.tournamentName.replace(/[^a-zа-я0-9]/gi, '_')}_${filename}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Изображение скачано!', 'success');
    });
  } catch (e) {
    showToast('Ошибка экспорта: ' + e.message, 'error');
  }
}

async function exportAllPNG() {
  await exportPNG('standings-table-wrap', 'tablitsa.png');
  setTimeout(() => exportPNG('matrix-table-wrap', 'matritsa.png'), 800);
  setTimeout(() => exportPNG('scorers-table-wrap', 'bombardiry.png'), 1600);
}

function generateShareLink() {
  const stripped = {
    tournamentName: state.tournamentName,
    numRounds: state.numRounds,
    teams: state.teams,
    fixtures: state.fixtures,
    generated: state.generated,
  };
  const json = JSON.stringify(stripped);
  const compressed = LZString.compressToEncodedURIComponent(json);
  const url = `${location.origin}${location.pathname}#share=${compressed}`;
  showShareModal(url);
}

function showShareModal(url) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <h3>🔗 Поделиться турниром</h3>
      <p>Любой, у кого есть эта ссылка, сможет видеть ваш турнир в режиме просмотра. Текущее состояние закодировано в URL.</p>
      <div class="share-link-box" id="share-link-text">${escapeHtml(url)}</div>
      <div class="modal-actions">
        <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Закрыть</button>
        <button class="btn btn-primary" onclick="copyShareLink('${url.replace(/'/g, "\\'")}')">📋 Скопировать ссылку</button>
      </div>
    </div>`;
  backdrop.onclick = () => backdrop.remove();
  document.body.appendChild(backdrop);
}

function copyShareLink(url) {
  navigator.clipboard.writeText(url).then(() => {
    showToast('Ссылка скопирована в буфер обмена!', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Ссылка скопирована!', 'success');
  });
  document.querySelector('.modal-backdrop')?.remove();
}

function confirmNewTournament() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <h3>⚠️ Начать новый турнир</h3>
      <p>Это действие безвозвратно удалит текущий турнир: все команды, матчи, результаты и авторов голов. Отменить будет нельзя.</p>
      <div class="modal-actions">
        <button class="btn" onclick="this.closest('.modal-backdrop').remove()">Отмена</button>
        <button class="btn btn-danger" onclick="resetTournament()">Да, удалить всё</button>
      </div>
    </div>`;
  backdrop.onclick = () => backdrop.remove();
  document.body.appendChild(backdrop);
}

function resetTournament() {
  state = {
    tournamentName: 'Кубок Чемпионов 2026',
    numRounds: 2,
    teams: [],
    fixtures: [],
    generated: false,
    prevRanks: {},
  };
  localStorage.removeItem(STORAGE_KEY);
  document.querySelector('.modal-backdrop')?.remove();
  switchTab('setup');
  renderAll();
  showToast('Турнир сброшен', 'success');
}

document.getElementById('tournament-name').addEventListener('input', e => {
  state.tournamentName = e.target.value || 'Pitch Pro';
  renderHeader();
  saveState();
});
document.getElementById('num-rounds').addEventListener('change', e => {
  const newRounds = parseInt(e.target.value);
  if (state.generated && state.fixtures.some(f => f.played)) {
    if (!confirm('Изменение количества кругов перегенерирует расписание и все сыгранные матчи будут потеряны. Продолжить?')) {
      e.target.value = state.numRounds;
      return;
    }
  }
  state.numRounds = newRounds;
  if (state.generated) {
    state.fixtures = [];
    state.generated = false;
  }
  saveState();
  renderAll();
});
document.getElementById('team-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addTeam(); }
});

loadState();
renderAll();

if (state.generated && state.fixtures.length) {
  if (state.fixtures.some(f => f.played)) {
    switchTab('standings');
  } else {
    switchTab('fixtures');
  }
}

if (isReadOnly) {
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.tab === 'setup') t.style.display = 'none';
  });
  if (state.fixtures.some(f => f.played)) {
    switchTab('standings');
  } else {
    switchTab('fixtures');
  }
}

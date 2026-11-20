const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLS = { todo: 'À faire', in_progress: 'En cours', review: 'Revue', done: 'Terminé' };
const PRIO = { urgent: 'Urgente', high: 'Haute', medium: 'Moyenne', low: 'Basse' };
let state = { token: localStorage.token, user: JSON.parse(localStorage.user || 'null'), tasks: [], users: [], view: 'board', mode: 'login' };

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token }, body: opts.body && JSON.stringify(opts.body) });
  if (r.status === 401 && state.token) { logout(); throw new Error('Session expirée'); }
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || 'Erreur ' + r.status);
  return data;
}
function logout() { localStorage.clear(); state.token = null; location.reload(); }

/* ---------- Auth ---------- */
function showAuth() { $('#auth').classList.remove('hidden'); $('#app').classList.add('hidden'); }
$('#tabLogin').onclick = () => setMode('login'); $('#tabReg').onclick = () => setMode('register');
function setMode(m) {
  state.mode = m; $('#aName').classList.toggle('hidden', m === 'login');
  $('#tabLogin').classList.toggle('on', m === 'login'); $('#tabReg').classList.toggle('on', m === 'register');
  $('#aGo').textContent = m === 'login' ? 'Se connecter' : 'Créer mon compte';
}
$('#aGo').onclick = async () => {
  try {
    const body = { email: $('#aEmail').value, password: $('#aPass').value, name: $('#aName').value };
    const d = await api('/api/auth/' + state.mode, { method: 'POST', body });
    localStorage.token = state.token = d.token; localStorage.user = JSON.stringify(d.user); state.user = d.user; boot();
  } catch (e) { $('#aErr').textContent = e.message; }
};

/* ---------- Boot ---------- */
async function boot() {
  if (!state.token) return showAuth();
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#meName').textContent = state.user.name;
  state.users = await api('/api/auth/users');
  $('#fUser').innerHTML = '<option value="">Tous les membres</option>' + state.users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
  render();
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.remove('on')); b.classList.add('on'); state.view = b.dataset.view; render();
});
['q', 'fPrio', 'fUser'].forEach(id => $('#' + id).addEventListener('input', () => { clearTimeout(window._t); window._t = setTimeout(render, 250); }));
$('#logout').onclick = logout;
$('#theme').onclick = () => { const d = document.documentElement; d.dataset.theme = d.dataset.theme === 'dark' ? 'light' : 'dark'; localStorage.theme = d.dataset.theme; };
document.documentElement.dataset.theme = localStorage.theme || 'light';
$('#newTask').onclick = () => openTask();

async function render() {
  $('header').classList.toggle('hidden', state.view !== 'board');
  if (state.view === 'board') return renderBoard();
  if (state.view === 'dash') return renderDash();
  return renderActivity();
}

/* ---------- Kanban ---------- */
async function renderBoard() {
  const p = new URLSearchParams({ q: $('#q').value, priority: $('#fPrio').value, assignee: $('#fUser').value });
  [...p.keys()].forEach(k => !p.get(k) && p.delete(k));
  state.tasks = await api('/api/tasks?' + p);
  $('#view').innerHTML = `<div class="board">${Object.entries(COLS).map(([k, label]) => {
    const list = state.tasks.filter(t => t.status === k);
    return `<div class="col" data-status="${k}"><h3>${label}<span>${list.length}</span></h3>${list.map(card).join('')}</div>`;
  }).join('')}</div>`;
  document.querySelectorAll('.task').forEach(el => {
    el.ondragstart = e => e.dataTransfer.setData('id', el.dataset.id);
    el.onclick = () => openTask(state.tasks.find(t => t._id === el.dataset.id));
  });
  document.querySelectorAll('.col').forEach(c => {
    c.ondragover = e => { e.preventDefault(); c.classList.add('over'); };
    c.ondragleave = () => c.classList.remove('over');
    c.ondrop = async e => {
      e.preventDefault(); c.classList.remove('over');
      await api(`/api/tasks/${e.dataTransfer.getData('id')}/status`, { method: 'PATCH', body: { status: c.dataset.status } }); renderBoard();
    };
  });
}
function card(t) {
  const late = t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date();
  const done = t.subtasks.filter(s => s.done).length, pct = t.subtasks.length ? Math.round(done / t.subtasks.length * 100) : 0;
  return `<div class="task ${t.priority}" draggable="true" data-id="${t._id}"><h4>${esc(t.title)}</h4>
    ${t.subtasks.length ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}
    <div class="meta"><span class="chip">${PRIO[t.priority]}</span>
    ${t.dueDate ? `<span class="chip ${late ? 'late' : ''}">📅 ${new Date(t.dueDate).toLocaleDateString('fr-FR')}</span>` : ''}
    ${t.assignee?.name ? `<span class="chip">👤 ${esc(t.assignee.name)}</span>` : ''}
    ${t.comments.length ? `<span class="chip">💬 ${t.comments.length}</span>` : ''}
    ${(t.labels || []).map(l => `<span class="chip">#${esc(l)}</span>`).join('')}</div></div>`;
}

/* ---------- Modal tâche ---------- */
function openTask(t) {
  const isNew = !t; t = t || { title: '', description: '', status: 'todo', priority: 'medium', labels: [], subtasks: [], comments: [] };
  const opt = (o, cur) => Object.entries(o).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');
  $('#sheet').innerHTML = `<h2>${isNew ? 'Nouvelle tâche' : 'Modifier la tâche'}</h2>
    <input id="mTitle" placeholder="Titre" value="${esc(t.title)}"><textarea id="mDesc" rows="3" placeholder="Description">${esc(t.description)}</textarea>
    <div class="row"><select id="mStatus">${opt(COLS, t.status)}</select><select id="mPrio">${opt(PRIO, t.priority)}</select></div>
    <div class="row"><input id="mDue" type="date" value="${t.dueDate ? t.dueDate.slice(0, 10) : ''}">
    <select id="mAss"><option value="">Non assignée</option>${state.users.map(u => `<option value="${u.id}" ${t.assignee?.id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
    <input id="mLabels" placeholder="Labels (séparés par des virgules)" value="${esc((t.labels || []).join(', '))}">
    <h4>Sous-tâches</h4><div id="subs">${t.subtasks.map(s => subRow(s.title, s.done)).join('')}</div>
    <button id="addSub" class="ghost">+ Ajouter une sous-tâche</button>
    ${isNew ? '' : `<h4>Commentaires</h4>${t.comments.map(c => `<div class="cmt"><b>${esc(c.authorName)}</b> · ${new Date(c.createdAt).toLocaleString('fr-FR')}<br>${esc(c.text)}</div>`).join('')}
    <div class="row"><input id="mCmt" placeholder="Écrire un commentaire…"><button id="sendCmt" style="flex:0">Envoyer</button></div>`}
    <p id="mErr" class="err"></p><div class="row"><button id="mSave" class="primary">Enregistrer</button>${isNew ? '' : '<button id="mDel" class="danger">Supprimer</button>'}<button id="mClose">Fermer</button></div>`;
  $('#modal').classList.remove('hidden');
  $('#addSub').onclick = () => $('#subs').insertAdjacentHTML('beforeend', subRow('', false));
  $('#mClose').onclick = () => $('#modal').classList.add('hidden');
  if (!isNew) {
    $('#mDel').onclick = async () => { if (confirm('Supprimer cette tâche ?')) { await api('/api/tasks/' + t._id, { method: 'DELETE' }); $('#modal').classList.add('hidden'); render(); } };
    $('#sendCmt').onclick = async () => { if (!$('#mCmt').value) return; const u = await api(`/api/tasks/${t._id}/comments`, { method: 'POST', body: { text: $('#mCmt').value } }); openTask(u); renderBoard(); };
  }
  $('#mSave').onclick = async () => {
    const uid = $('#mAss').value, u = state.users.find(x => String(x.id) === uid);
    const body = { title: $('#mTitle').value, description: $('#mDesc').value, status: $('#mStatus').value, priority: $('#mPrio').value,
      dueDate: $('#mDue').value || null, assignee: u ? { id: u.id, name: u.name } : undefined,
      labels: $('#mLabels').value.split(',').map(s => s.trim()).filter(Boolean),
      subtasks: [...document.querySelectorAll('.sub')].map(r => ({ title: r.querySelector('input[type=text]').value, done: r.querySelector('input[type=checkbox]').checked })).filter(s => s.title) };
    try { await api(isNew ? '/api/tasks' : '/api/tasks/' + t._id, { method: isNew ? 'POST' : 'PUT', body }); $('#modal').classList.add('hidden'); render(); }
    catch (e) { $('#mErr').textContent = e.message; }
  };
}
const subRow = (title, done) => `<div class="sub"><input type="checkbox" ${done ? 'checked' : ''}><input type="text" value="${esc(title)}" placeholder="Sous-tâche"></div>`;

/* ---------- Dashboard ---------- */
async function renderDash() {
  const [s, a] = await Promise.all([api('/api/tasks/stats'), api('/api/analytics/summary')]);
  const max = Math.max(1, ...a.daily.map(d => Math.max(d.created, d.completed)));
  const bars = (map, labels) => Object.entries(labels).map(([k, l]) => `<div class="bar"><span>${l}</span><div><i style="width:${(map[k] || 0) / Math.max(1, s.total) * 100}%"></i></div><b>${map[k] || 0}</b></div>`).join('');
  const rate = s.total ? Math.round((s.byStatus.done || 0) / s.total * 100) : 0;
  $('#view').innerHTML = `<div class="grid"><div class="kpi">Total<b>${s.total}</b></div><div class="kpi">En cours<b>${s.byStatus.in_progress || 0}</b></div>
    <div class="kpi">En retard<b style="color:var(--bad)">${s.overdue}</b></div><div class="kpi">Complétion<b style="color:var(--ok)">${rate}%</b></div></div>
    <div class="grid"><div class="panel"><h3>Par statut</h3>${bars(s.byStatus, COLS)}</div><div class="panel"><h3>Par priorité</h3>${bars(s.byPriority, PRIO)}</div></div>
    <div class="panel"><h3>7 derniers jours <small class="muted">(violet : créées · vert : terminées)</small></h3><div class="days">${a.daily.map(d =>
      `<div><span style="display:flex;align-items:flex-end;justify-content:center;flex:1"><i style="width:40%;height:${d.created / max * 100}%"></i><i class="d" style="width:40%;height:${d.completed / max * 100}%"></i></span>${d.day.slice(5)}</div>`).join('')}</div></div>
    <div class="panel"><h3>Top contributeurs</h3>${a.topContributors.map(c => `<div class="event">${esc(c.user_name)} — ${c.actions} actions, ${c.completed} tâches terminées</div>`).join('') || '<p class="muted">Aucune activité.</p>'}</div>`;
}

/* ---------- Activité ---------- */
async function renderActivity() {
  const ev = await api('/api/analytics/activity?limit=60');
  const L = { 'task.created': '✨ a créé', 'task.updated': '✏️ a modifié', 'task.moved': '➡️ a déplacé', 'task.completed': '✅ a terminé', 'task.commented': '💬 a commenté', 'task.deleted': '🗑️ a supprimé' };
  $('#view').innerHTML = `<div class="panel"><h3>Flux d'activité</h3>${ev.map(e => `<div class="event"><b>${esc(e.user_name)}</b> ${L[e.type] || e.type} « ${esc(e.title)} » <span class="muted">· ${new Date(e.created_at).toLocaleString('fr-FR')}</span></div>`).join('') || '<p class="muted">Aucune activité.</p>'}</div>`;
}
$('#modal').onclick = e => { if (e.target.id === 'modal') e.target.classList.add('hidden'); };
boot();

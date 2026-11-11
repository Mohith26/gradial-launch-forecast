import * as F from './src/forecast.js';
import * as S from './src/scenario.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = 'gradial-launch-forecast:v1';
const COLORS = { henry: '#3080ff', priya: '#ac4bff', maya: '#e5484d', ana: '#f97316', sam: '#16a34a', kenji: '#0ea5e9', jonas: '#a16207' };
const LAUNCH_OPTIONS = [8 * 24 + 13, 9 * 24 + 13, 10 * 24 + 13, 11 * 24 + 13, 14 * 24 + 13];

const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();
const st = { applied: saved.applied || [], launch: saved.launch || S.LAUNCH, view: 'forecast', sel: null, q: '', calib: null, cache: null };
const persist = () => localStorage.setItem(LS, JSON.stringify({ applied: st.applied, launch: st.launch }));
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800); }
const icons = () => window.lucide && window.lucide.createIcons();
window.__lucideReady = icons;

const hist = S.makeHistory();
const basePlan = S.demoPlan(hist);
function plan() {
  let p = { ...basePlan, launch: st.launch };
  for (const i of st.applied) p = F.applyAction(p, S.CANDIDATE_ACTIONS[i]);
  return p;
}
function compute() {
  const key = JSON.stringify([st.applied, st.launch]);
  if (st.cache && st.cache.key === key) return st.cache;
  const p = plan();
  const fc = F.forecast(p, { runs: 2000, seed: 1 });
  const remaining = S.CANDIDATE_ACTIONS.map((a, i) => ({ ...a, i })).filter(a => !st.applied.includes(a.i) && !(a.type === 'approver' && typeof stepOf(p, a.step).approver === 'object'));
  const recs = F.compareActions(p, remaining, { runs: 1500, seed: 7 });
  st.cache = { key, p, fc, recs, rollup: F.medianRollup(p) };
  return st.cache;
}
const stepOf = (p, id) => p.steps.find(s => s.id === id);

// ---------------------------------------------------------------- formatting
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function when(t, { time = true } = {}) {
  const d = F.fmtTime(t, S.START_DATE);
  const wd = WD[(d.getUTCDay() + 6) % 7];
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (!time) return `${wd}, ${md}`;
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${wd}, ${md} · ${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
const pct = x => `${Math.round(x * 100)}%`;
const pts = x => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))} pts`;
function person(id) { return basePlan.people[id]; }
function approverHtml(a) {
  if (a === 'grady') return `<span class="who"><span class="grady">g</span>Grady</span>`;
  if (typeof a === 'object') { const g = Object.values(S.GROUPS).find(x => x.members.join() === a.group.join()); return `<span class="who"><i data-lucide="users"></i>${esc(g ? g.name : a.group.join(', '))}</span>`; }
  const p = person(a);
  return `<span class="who"><span class="avatar" style="background:${COLORS[a]}">${p.name.split(' ').map(x => x[0]).join('')}</span>${esc(p.name)}</span>`;
}
const riskClass = p => p >= 0.75 ? 'good' : p >= 0.5 ? 'mid' : 'bad';

// ---------------------------------------------------------------- left: task home
function renderTask(c) {
  const p = c.fc.p;
  $('#taskhome').innerHTML = `
    <div class="slackcard"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="10" y="2" width="4" height="9" rx="2" fill="#36c5f0"/><rect x="13" y="10" width="9" height="4" rx="2" fill="#2eb67d"/><rect x="10" y="13" width="4" height="9" rx="2" fill="#ecb22e"/><rect x="2" y="10" width="9" height="4" rx="2" fill="#e01e5a"/></svg>
      <div class="t"><b>Slack</b><span>This task was ingested from Slack.</span></div><span class="open">Open in Slack <i data-lucide="arrow-up-right"></i></span></div>
    <div class="chips"><span class="chip-wf"><i data-lucide="git-fork"></i>Workflow</span><i data-lucide="plus" style="color:#737373"></i></div>
    <h1 class="title">Q4 Launch: Fleet Analytics</h1>
    <div class="props">
      <span class="k">Properties</span><div class="v"><span><span class="dot-p"></span>In Progress</span><span><span class="grady">g</span>Grady</span><span><i data-lucide="tag" style="color:#737373"></i>q4-launch</span></div>
      <span class="k">Approvers</span><div class="v">${approverHtml('henry')}</div>
      <span class="k">Launch</span><div class="v"><span>${when(st.launch)} ET</span><a href="#/forecast" class="risk-pill ${riskClass(p)}" title="Forecast probability of going live on time">${pct(p)} on time</a></div>
    </div>
    <span class="showmore">Show More <i data-lucide="chevron-down"></i></span>
    <div class="req"><div class="h"><span>Task Request</span><span>Nov 9 at 9:02 AM <i data-lucide="ellipsis-vertical" style="vertical-align:-3px"></i></span></div>
      <p>Launch the Fleet Analytics campaign for our B2B audiences: web pages in EN, DE, FR and JA, a 6-email nurture in SFMC, legal sign-off on all claims. Go-live is Wednesday Nov 18 at 1 PM ET with the press release.</p>
      <span class="file"><i></i>Ballard-Fleet-Analytics-Brief.pdf</span></div>
    <div class="feed">
      <div class="ev"><span class="gi">g</span><div><div class="t"><b>Planned 10 subtasks</b> · 7 need human approval</div><div class="s">Nov 9 at 9:03 AM</div></div></div>
      <div class="ev"><span class="gi fc"><i data-lucide="chart-no-axes-column"></i></span><div><div class="t"><b>Launch forecast</b> · ${pct(p)} chance of going live by ${when(st.launch, { time: false })}</div><div class="s">2,000 simulated runs from each approver’s last 120 reviews · <a href="#/forecast" style="color:#155dfc">Open forecast</a></div></div></div>
      ${st.applied.map(i => `<div class="ev"><span class="gi ok"><i data-lucide="check"></i></span><div><div class="t"><b>${esc(S.CANDIDATE_ACTIONS[i].label)}</b></div><div class="s">Applied from the forecast</div></div></div>`).join('')}
    </div>
    <div class="todo"><i data-lucide="circle-check" style="color:#16a34a"></i><b style="font-weight:500">Agent’s todo list</b><span class="st">In progress</span><i data-lucide="chevron-down"></i></div>`;
}

// ---------------------------------------------------------------- right: forecast view
function histogram(c) {
  const ends = c.fc.ends, W = 680, H = 210, padL = 34, padB = 26, padT = 20;
  const t0 = 0, t1 = Math.max(c.p.launch + 48, F.quantile(ends, 0.95));
  const nb = 36, bw = (t1 - t0) / nb, bins = new Array(nb).fill(0);
  for (const e of ends) { const b = Math.min(nb - 1, Math.floor((e - t0) / bw)); if (e <= t1) bins[b]++; }
  const max = Math.max(...bins), x = t => padL + (t - t0) / (t1 - t0) * (W - padL - 8), y = v => H - padB - v / max * (H - padB - padT);
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = max * k / 4; g += `<line x1="${padL}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="#f0f0f0"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v / ends.length * 100)}%</text>`; }
  bins.forEach((v, b) => { const a = t0 + b * bw; g += `<rect x="${x(a) + 1}" y="${y(v)}" width="${Math.max(1, x(a + bw) - x(a) - 2)}" height="${H - padB - y(v)}" rx="2" fill="${a + bw / 2 <= c.p.launch ? '#3080ff' : '#90c5ff'}"><title>${when(a)} – ${when(a + bw)}: ${(v / ends.length * 100).toFixed(1)}% of runs</title></rect>`; });
  const every = t1 > 24 * 16 ? 2 : 1;
  for (let d = 0; d * 24 <= t1; d++) { const t = d * 24 + 12; if (t > t1) break; if (d % every === 0) { const dt = F.fmtTime(t, S.START_DATE); g += `<text x="${x(t)}" y="${H - 8}" text-anchor="middle">${WD[(dt.getUTCDay() + 6) % 7]} ${dt.getUTCDate()}</text>`; } }
  const L = x(c.p.launch);
  g += `<line x1="${L}" x2="${L}" y1="${padT - 6}" y2="${H - padB}" stroke="#0a0a0a" stroke-dasharray="4 3"/><text x="${L + 5}" y="${padT}" fill="#0a0a0a" style="fill:#0a0a0a">Launch</text>`;
  const r = x(c.rollup);
  g += `<line x1="${r}" x2="${r}" y1="${padT + 8}" y2="${H - padB}" stroke="#d97706" stroke-dasharray="2 3"/><text x="${r - 5}" y="${padT + 14}" text-anchor="end" style="fill:#b45309">Due-date roll-up</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribution of simulated go-live times">${g}</svg>`;
}

function renderForecast(c) {
  const fc = c.fc, p = c.p;
  const rows = F.topo(p.steps).filter(s => !st.q || s.name.toLowerCase().includes(st.q.toLowerCase()));
  const recs = c.recs;
  $('#rbody').innerHTML = `
    <div class="card summary">
      <div><h3>On-time probability</h3><div class="sub">Go-live by ${when(p.launch)} ET</div>
        <div class="bigp" style="color:${fc.p >= .75 ? '#16a34a' : fc.p >= .5 ? '#b45309' : '#e40014'}">${pct(fc.p)} <small>± ${Math.round((fc.ci[1] - fc.ci[0]) * 50)} pts</small></div>
        <label class="launchsel">Launch <select id="launch" aria-label="Launch date">${LAUNCH_OPTIONS.map(t => `<option value="${t}" ${t === st.launch ? 'selected' : ''}>${when(t)}</option>`).join('')}</select></label></div>
      <div class="kv2"><div><span>Median go-live</span><b>${when(fc.p50)}</b></div><div><span>80% confident by</span><b>${when(fc.p80)}</b></div><div><span>Simulated runs</span><b>${fc.runs.toLocaleString()}</b></div></div>
      <div class="rollup"><i data-lucide="triangle-alert"></i><div>Due dates in the Calendar roll up to <b>${when(c.rollup)}</b>${c.rollup <= p.launch ? ', which looks on track. They assume every review takes its median time, once.' : '.'}</div></div>
    </div>
    <div class="card" style="margin-top:12px"><h3>When the campaign goes live</h3><div class="sub">Share of 2,000 simulated runs by go-live time (ET). Approver history, working hours, PTO, daily review capacity and rework are simulated.</div>${histogram(c)}
      <div class="legendrow"><span><i style="background:#3080ff"></i>Live by launch</span><span><i style="background:#90c5ff"></i>Late</span><span><i style="background:none;border-left:2px dashed #0a0a0a;border-radius:0;width:2px"></i>Launch</span><span><i style="background:none;border-left:2px dotted #d97706;border-radius:0;width:2px"></i>Due-date roll-up</span></div></div>
    <div class="sect"><h2>Recommended changes</h2><span class="sub">Each change re-simulated on the same 1,500 runs; 95% interval on the gain</span></div>
    ${st.applied.length ? `<div class="applied">${st.applied.map(i => `<span>${esc(S.CANDIDATE_ACTIONS[i].short)}<button data-undo="${i}" aria-label="Undo ${esc(S.CANDIDATE_ACTIONS[i].short)}"><i data-lucide="x"></i></button></span>`).join('')}</div>` : ''}
    <div class="recs" style="margin-top:8px">${recs.length ? recs.map((r, k) => `<div class="rec"><div><b>${esc(r.action.label)}</b><div class="why">${esc(why(r.action, c))}</div></div>
      <div style="display:flex;gap:14px;align-items:center"><div class="gain ${r.significant ? '' : 'zero'}">${r.significant ? pts(r.delta) : 'No clear gain'}<small>${pts(r.ci[0]).replace(' pts', '')} to ${pts(r.ci[1])}</small></div>
      <button class="btn ${r.significant && k === 0 ? 'primary' : 'outline'}" data-apply="${r.action.i}" ${r.significant ? '' : 'disabled'}>Apply</button></div></div>`).join('') : '<div class="card sub">No further changes improve the forecast.</div>'}</div>
    <div class="sect"><h2>What’s driving it</h2><span class="sub">Critical = share of runs where this step was on the path that set the go-live time</span></div>
    <table class="gt"><thead><tr><th>Title</th><th>Approver</th><th>Critical</th><th>Done by (median)</th><th>Review rounds</th></tr></thead><tbody>
    ${rows.length ? rows.map(s => { const cr = fc.criticality[s.id]; return `<tr class="click ${st.sel === s.id ? 'sel' : ''}" data-step="${s.id}" tabindex="0"><td class="tt"><span class="tchip"><i data-lucide="tag"></i>Task</span>${esc(s.name)}</td><td>${approverHtml(s.approver)}</td><td><div class="crit"><div class="bar"><i class="${cr > .5 ? 'hot' : ''}" style="width:${Math.round(cr * 100)}%"></i></div>${pct(cr)}</div></td><td>${when(fc.stepP50[s.id])}</td><td>${s.approver === 'grady' ? '–' : fc.meanRounds[s.id].toFixed(2)}</td></tr>`; }).join('') : '<tr><td colspan="5" style="color:#737373">No subtasks match.</td></tr>'}
    </tbody></table>
    <div class="sect"><h2>How reliable is this?</h2><span class="sub">Backtest on 400 simulated past campaigns played out under a harsher hidden truth</span></div>
    <div class="card" id="calib">${calibHtml()}</div>`;
  bindForecast(c);
}

function why(a, c) {
  const s = stepOf(c.p, a.step);
  if (a.type === 'approver') {
    const cur = s.approver, g = Object.values(S.GROUPS).find(x => x.members.join() === a.to.group.join());
    const m = typeof cur === 'string' ? person(cur) : null;
    return `${m ? `${m.name} takes a median ${F.quantile(m.lat, 0.5).toFixed(1)} working hours${m.pto && m.pto.length ? ` and is out ${m.pto.map(d => WD[d % 7]).join('–')}` : ''}` : 'Current approver'}; any of ${g.members.map(id => person(id).name.split(' ')[0]).join(' or ')} could approve.`;
  }
  if (a.type === 'early-review') return 'Reviewing drafts overlaps legal with the web build, but drafts change more, so rework is likelier.';
  if (a.type === 'split') return 'The first batch unblocks downstream steps sooner; useful only if this step is on the critical path.';
  return '';
}

function calibHtml() {
  const b = st.calib;
  if (b === null) return '<div class="sub">Loading backtest…</div>';
  if (b === false) return '<div class="sub">Couldn’t load results/backtest.json. <button class="btn outline" id="retry">Retry</button></div>';
  const W = 260, H = 170, pad = 28, x = v => pad + v * (W - pad - 6), y = v => H - pad - v * (H - pad - 8);
  let g = `<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="#d4d4d4" stroke-dasharray="3 3"/>`;
  for (const v of [0, .5, 1]) g += `<text x="${x(v)}" y="${H - 10}" text-anchor="middle">${v * 100}%</text><text x="${pad - 6}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`;
  g += `<polyline fill="none" stroke="#3080ff" stroke-width="2" points="${b.calibration.map(k => `${x(k.predicted)},${y(k.observed)}`).join(' ')}"/>`;
  for (const k of b.calibration) g += `<circle cx="${x(k.predicted)}" cy="${y(k.observed)}" r="${3 + Math.sqrt(k.n) / 3}" fill="#3080ff" fill-opacity=".85"><title>${k.n} campaigns: forecast ${pct(k.predicted)}, actually on time ${pct(k.observed)}</title></circle>`;
  return `<div style="display:grid;grid-template-columns:${W}px 1fr;gap:18px;align-items:center">
    <svg class="chart" style="height:${H}px;width:${W}px" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calibration: forecast vs actual on-time rate">${g}<text x="${W / 2}" y="${H}" text-anchor="middle">forecast</text></svg>
    <div class="kv" style="margin:0"><span>Campaigns backtested</span><b>${b.n}</b><span>Late launches</span><b>${b.rollup.late_total}</b>
      <span>Late ones the due-date roll-up called on track</span><b style="color:#e40014">${b.rollup.late_called_on_time} (${pct(b.rollup.late_called_on_time_rate)})</b>
      <span>Late ones the forecast gave under 50%</span><b style="color:#16a34a">${b.forecast_late_flagged.late_with_p_below_half} (${pct(b.forecast_late_flagged.rate)})</b>
      <span>Average calibration gap</span><b>${(b.ece * 100).toFixed(1)} pts</b><span>Brier score (lower is better)</span><b>${b.brier.toFixed(3)} vs ${b.rollup.brier.toFixed(3)} roll-up</b></div></div>`;
}

function openDrawer(c, id) {
  st.sel = id;
  const s = stepOf(c.p, id), fc = c.fc;
  document.querySelectorAll('tr[data-step]').forEach(r => r.classList.toggle('sel', r.dataset.step === id));
  const ids = s.approver === 'grady' ? [] : typeof s.approver === 'string' ? [s.approver] : s.approver.group;
  const people = ids.map(person);
  const depNames = s.deps.map(d => stepOf(c.p, d).name);
  let hist = '';
  for (const m of people) {
    const W = 380, H = 90, max = 40, nb = 20, bins = new Array(nb).fill(0);
    for (const h of m.lat) bins[Math.min(nb - 1, Math.floor(h / max * nb))]++;
    const top = Math.max(...bins);
    const rr = F.mulberry32(F.hash('beta', m.id)); const draws = Array.from({ length: 3000 }, () => F.betaSample(rr, m.rejA, m.rejB)).sort((a, b) => a - b);
    hist += `<div style="margin-top:14px"><div style="display:flex;justify-content:space-between;align-items:center">${approverHtml(m.id)}<span class="meta">${esc(m.role)} · UTC${m.tz === 0 ? '−5' : m.tz > 0 ? '+' + (m.tz - 5) : '−' + (5 - m.tz)} · ${m.cap}/day</span></div>
      <svg class="chart" style="height:${H + 18}px" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Review time history">${bins.map((v, b) => `<rect x="${b * W / nb + 1}" y="${H - v / top * (H - 6)}" width="${W / nb - 2}" height="${v / top * (H - 6)}" rx="2" fill="#90c5ff"/>`).join('')}<text x="0" y="${H + 14}">0 h</text><text x="${W / 2}" y="${H + 14}" text-anchor="middle">20 working h</text><text x="${W}" y="${H + 14}" text-anchor="end">40+</text></svg>
      <div class="grid2"><div class="stat"><b>${F.quantile(m.lat, 0.5).toFixed(1)} h</b><span>median review (working hours), last ${m.n}</span></div><div class="stat"><b>${F.quantile(m.lat, 0.9).toFixed(1)} h</b><span>90th percentile</span></div>
      <div class="stat"><b>${pct(m.rejA / (m.rejA + m.rejB))}</b><span>sent back for changes (95%: ${pct(F.quantile(draws, .025))}–${pct(F.quantile(draws, .975))})</span></div><div class="stat"><b>${m.pto && m.pto.length ? m.pto.map(d => WD[d % 7]).join(', ') : 'None'}</b><span>PTO before launch</span></div></div></div>`;
  }
  $('#drawer').innerHTML = `<button class="x" id="dx" aria-label="Close"><i data-lucide="x"></i></button>
    <span class="tchip"><i data-lucide="tag"></i>Task</span><span class="achip">Agentic</span>
    <h3>${esc(s.name)}</h3><div class="meta">Waits on ${depNames.length ? depNames.map(esc).join(', ') : 'nothing'}${s.artifacts ? ` · ${s.artifacts} artifact${s.artifacts === 1 ? '' : 's'}` : ''}</div>
    <div class="grid2"><div class="stat"><b>${pct(fc.criticality[id])}</b><span>of runs on the critical path</span></div><div class="stat"><b>${when(fc.stepP50[id])}</b><span>median finish · 80%: ${when(fc.stepP80[id])}</span></div></div>
    ${people.length ? hist : '<div class="meta" style="margin-top:12px">Approved by Grady’s QA agent; no human queue.</div>'}`;
  $('#drawer').classList.add('open');
  icons();
  $('#dx').onclick = closeDrawer;
}
function closeDrawer() { st.sel = null; const d = $('#drawer'); if (d) d.classList.remove('open'); document.querySelectorAll('tr.sel').forEach(r => r.classList.remove('sel')); if (location.hash.startsWith('#/step/')) history.replaceState(null, '', '#/' + st.view); }

function bindForecast(c) {
  $('#launch').onchange = e => { st.launch = +e.target.value; persist(); toast('Launch moved. Re-simulated.'); render(); };
  document.querySelectorAll('[data-apply]').forEach(b => b.onclick = () => applyRec(+b.dataset.apply));
  document.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => { st.applied = st.applied.filter(i => i !== +b.dataset.undo); persist(); toast('Change undone'); render(); });
  document.querySelectorAll('tr[data-step]').forEach(r => { r.onclick = () => { location.hash = `#/step/${r.dataset.step}`; }; r.onkeydown = e => { if (e.key === 'Enter') r.click(); }; });
  const rt = $('#retry'); if (rt) rt.onclick = loadCalib;
}
function applyRec(i) {
  const before = compute().fc.p;
  st.applied.push(i); persist();
  const after = compute().fc.p;
  toast(`${S.CANDIDATE_ACTIONS[i].short}: ${pct(before)} → ${pct(after)} on time`);
  render();
}

// ---------------------------------------------------------------- table view (Gradial's own)
function renderTable(c) {
  const p = c.p;
  const rows = F.topo(p.steps).filter(s => !st.q || s.name.toLowerCase().includes(st.q.toLowerCase()));
  $('#rbody').innerHTML = `<table class="gt"><thead><tr><th><input type="checkbox" aria-label="Select all"></th><th>Title</th><th>Status</th><th>Dependencies</th><th>Approver</th><th>On-time impact</th></tr></thead><tbody>
    ${rows.map(s => `<tr class="click" data-step="${s.id}" tabindex="0"><td><input type="checkbox" aria-label="Select ${esc(s.name)}"></td><td class="tt"><span class="tchip"><i data-lucide="tag"></i>Task</span>${esc(s.name)}</td><td><span class="status planned"><i data-lucide="circle-dashed"></i>Planned</span></td>
      <td>${s.deps.length ? s.deps.map(d => `<span class="dep wait" title="${esc(stepOf(p, d).name)}"><i data-lucide="clock"></i>${esc(stepOf(p, d).name)}</span>`).join('<br>') : '<span style="color:#a3a3a3">--</span>'}</td><td>${approverHtml(s.approver)}</td>
      <td><div class="crit"><div class="bar"><i class="${c.fc.criticality[s.id] > .5 ? 'hot' : ''}" style="width:${Math.round(c.fc.criticality[s.id] * 100)}%"></i></div>${pct(c.fc.criticality[s.id])}</div></td></tr>`).join('')}
    </tbody></table><div style="display:flex;justify-content:center;margin-top:18px"><span class="btn outline"><i data-lucide="circle-plus" style="color:#3080ff"></i>Add</span>&nbsp;<span class="btn outline"><i data-lucide="upload"></i>Import</span>&nbsp;<span class="btn outline"><i data-lucide="circle-play"></i>Batch</span></div>`;
  document.querySelectorAll('tr[data-step]').forEach(r => { r.onclick = e => { if (e.target.matches('input')) return; location.hash = `#/step/${r.dataset.step}`; }; });
}

// ---------------------------------------------------------------- shell
function render() {
  const c = compute();
  renderTask(c);
  $('#viewname').textContent = st.view === 'table' ? 'Table' : 'Forecast';
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-checked', b.dataset.view === st.view));
  if (st.view === 'table') renderTable(c); else renderForecast(c);
  icons();
  if (st.sel) openDrawer(c, st.sel);
  window.__readyAt = window.__readyAt || Math.round(performance.now());
}
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'table') { st.view = 'table'; st.sel = null; }
  else if (a === 'step' && b && stepOf(basePlan, b)) { st.sel = b; }
  else { st.view = 'forecast'; st.sel = null; }
  render();
}
async function loadCalib() {
  try { const r = await fetch('results/backtest.json'); if (!r.ok) throw new Error(r.status); st.calib = await r.json(); }
  catch { st.calib = false; }
  const el = $('#calib'); if (el) { el.innerHTML = calibHtml(); const rt = $('#retry'); if (rt) rt.onclick = loadCalib; }
}
function exportCSV() {
  const c = compute();
  const rows = [['step', 'approver', 'critical_share', 'median_finish_ET', 'p80_finish_ET', 'mean_review_rounds'], ...F.topo(c.p.steps).map(s => [s.name, typeof s.approver === 'object' ? s.approver.group.join('|') : s.approver, c.fc.criticality[s.id].toFixed(3), when(c.fc.stepP50[s.id]), when(c.fc.stepP80[s.id]), c.fc.meanRounds[s.id].toFixed(2)]),
    [], ['launch', when(c.p.launch)], ['p_on_time', c.fc.p.toFixed(4)], ['ci95_low', c.fc.ci[0].toFixed(4)], ['ci95_high', c.fc.ci[1].toFixed(4)], ['median_go_live', when(c.fc.p50)], ['p80_go_live', when(c.fc.p80)], ['due_date_rollup', when(c.rollup)]];
  const csv = rows.map(r => r.map(v => /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n') + '\n';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'q4-launch-forecast.csv'; a.click();
  toast('Exported q4-launch-forecast.csv');
}

$('#viewbtn').onclick = e => { e.stopPropagation(); const m = $('#viewmenu'); m.classList.toggle('open'); $('#viewbtn').setAttribute('aria-expanded', m.classList.contains('open')); };
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { $('#viewmenu').classList.remove('open'); location.hash = `#/${b.dataset.view}`; });
document.addEventListener('click', () => $('#viewmenu').classList.remove('open'));
$('#export').onclick = exportCSV;
$('#filterbtn').onclick = () => toast('Filter by approver or status is in Gradial’s full app');
$('#q').addEventListener('input', e => { st.q = e.target.value; render(); $('#q').focus(); });
document.addEventListener('keydown', e => {
  if (e.target.matches('input, select')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') { $('#help').classList.remove('open'); closeDrawer(); return; }
  if (e.key === '?') { $('#help').classList.toggle('open'); return; }
  if (e.key === 'f') location.hash = '#/forecast';
  if (e.key === 't') location.hash = '#/table';
  if (e.key === 'e') exportCSV();
  if (e.key === 'u' && st.applied.length) { st.applied.pop(); persist(); toast('Change undone'); render(); }
  if (e.key === 'a') { const r = compute().recs.find(x => x.significant); if (r) applyRec(r.action.i); }
  if (e.key === 'j' || e.key === 'k') {
    const ids = F.topo(basePlan.steps).map(s => s.id); const i = ids.indexOf(st.sel);
    const n = ids[Math.max(0, Math.min(ids.length - 1, i < 0 ? 0 : i + (e.key === 'j' ? 1 : -1)))];
    location.hash = `#/step/${n}`;
  }
});
$('#help').onclick = e => { if (e.target.id === 'help') e.target.classList.remove('open'); };
window.addEventListener('hashchange', route);
route();
loadCalib();

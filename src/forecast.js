// Launch forecast for Gradial workflows: Monte Carlo over the subtask DAG with agent run
// times, human approval latencies bootstrapped from each approver's history, working hours
// and time zones, daily review capacity, PTO, and reject -> rework -> re-review loops.
// Pure ES module (no DOM) shared by the browser demo, scripts and node --test.

// ------------------------------------------------------------------ RNG
export function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function hash(...xs) { // stable 32-bit hash of numbers/strings, for common random numbers
  let h = 2166136261 >>> 0;
  for (const x of xs) { const s = String(x); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } h ^= 0x9e3779b9; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function normal(rnd) { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }
export const lognormal = (rnd, median, sigma) => median * Math.exp(sigma * normal(rnd));
export function betaSample(rnd, a, b) { // via two gammas (Marsaglia-Tsang)
  const g = k => { if (k < 1) return g(k + 1) * Math.pow(rnd(), 1 / k); const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = normal(rnd); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = rnd(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } };
  const x = g(a), y = g(b); return x / (x + y);
}

// ------------------------------------------------------------------ calendar
// Time is hours since Monday 00:00 America/New_York of the campaign's start week.
// A person works Mon-Fri, 09:00-18:00 local; tz = offset from ET in hours (e.g. Pacific -3).
export const DAY = 24;
export function isWorking(t, p) {
  const local = t + (p.tz || 0);
  const d = Math.floor(local / DAY), h = local - d * DAY, dow = ((d % 7) + 7) % 7; // 0 = Monday
  if (dow >= 5) return false;
  if (p.pto && p.pto.includes(dayIndex(t, p))) return false;
  return h >= (p.start ?? 9) && h < (p.end ?? 18);
}
export const dayIndex = (t, p) => Math.floor((t + (p.tz || 0)) / DAY);
// Advance from t by `h` working hours of person p (resolution 15 min, exact enough for days-long horizons).
export function addWorkingHours(t, h, p, extraOff = null) {
  const step = 0.25;
  let left = h, cur = t;
  for (let guard = 0; guard < 4 * 24 * 120; guard++) {
    const off = extraOff && extraOff.has(dayIndex(cur, p));
    if (isWorking(cur, p) && !off) {
      if (left <= step) return cur + left;
      left -= step;
    }
    cur += step;
  }
  return cur;
}
export function nextWorkingStart(t, p, extraOff = null) {
  let cur = t;
  for (let guard = 0; guard < 4 * 24 * 60; guard++) { if (isWorking(cur, p) && !(extraOff && extraOff.has(dayIndex(cur, p)))) return cur; cur += 0.25; }
  return cur;
}
export function fmtTime(t, startDate) { // startDate: ISO date of the Monday
  const d = new Date(startDate + 'T00:00:00Z');
  d.setUTCMinutes(d.getUTCMinutes() + Math.round(t * 60));
  return d;
}

// ------------------------------------------------------------------ history -> estimates
// history[person] = [{ hours: working hours to decision, rejected: bool }]
export function personModel(person, history) {
  const h = history[person.id] || [];
  const lat = h.map(x => x.hours).sort((a, b) => a - b);
  const rej = h.filter(x => x.rejected).length;
  // daily capacity: a high percentile of decisions per working day observed in history
  return { ...person, lat, rejA: 1 + rej, rejB: 1 + h.length - rej, n: h.length };
}
export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// ------------------------------------------------------------------ simulation
// plan = { launch: hours, steps: [{ id, name, kind:'agent'|'approval', deps:[], agent:{median,sigma},
//          approver: personId | {group:[ids]} | 'grady', reviewMult?: number }], people: {id: model} }
export function topo(steps) {
  const byId = new Map(steps.map(s => [s.id, s])), seen = new Set(), out = [];
  const visit = s => { if (seen.has(s.id)) return; seen.add(s.id); for (const d of s.deps) visit(byId.get(d)); out.push(s); };
  steps.forEach(visit);
  return out;
}

function drawLatency(rnd, m) {
  if (!m.lat.length) return lognormal(rnd, 8, 0.8);
  // smoothed bootstrap: resample a past latency, jitter it a little (log-scale)
  const x = m.lat[Math.floor(rnd() * m.lat.length)];
  return Math.max(0.05, x * Math.exp(0.15 * normal(rnd)));
}

// One review by one person: queue on their daily capacity, then their latency in working hours.
// Ground truth (used only to generate history and backtest outcomes): the person's own
// lognormal, 1.6x slower on requests that land on a Friday. The forecaster never sees this.
export function truthLatency(rnd, m, arrive) {
  const d = Math.floor((arrive + (m.tz || 0)) / DAY), dow = ((d % 7) + 7) % 7;
  return lognormal(rnd, m.true.median, m.true.sigma) * (dow === 4 ? 1.6 : 1);
}
export function workingHoursBetween(a, b, p) {
  let h = 0;
  for (let t = a; t < b; t += 0.25) if (isWorking(t, p)) h += 0.25;
  return h;
}

function reviewBy(m, arrive, rnd, state, extraOff) {
  const lat = (state.truth ? truthLatency(rnd, m, nextWorkingStart(arrive, m, extraOff)) : drawLatency(rnd, m)) * (state.reviewMult || 1);
  let t = addWorkingHours(nextWorkingStart(arrive, m, extraOff), lat, m, extraOff);
  if (m.cap) { // at most `cap` decisions per working day
    const used = state.load[m.id] || (state.load[m.id] = {});
    for (let guard = 0; guard < 60; guard++) {
      const d = dayIndex(t, m);
      if ((used[d] || 0) < m.cap) { used[d] = (used[d] || 0) + 1; break; }
      t = addWorkingHours(nextWorkingStart((d + 1) * DAY - (m.tz || 0), m, extraOff), 0.5, m, extraOff);
    }
  }
  return t;
}

export function simulateOnce(plan, run, seed = 1, opts = {}) {
  const order = plan._order || (plan._order = topo(plan.steps));
  const fin = {}, start = {}, cause = {}, rounds = {};
  const state = { load: {}, truth: !!opts.truth };
  const unplannedOff = {};
  if (opts.background) { // ground truth only: other campaigns already use part of each reviewer's day
    const br = mulberry32(hash(seed, run, 'bg'));
    for (const id of Object.keys(plan.people)) { const m = plan.people[id]; if (!m.cap) continue; state.load[id] = {}; for (let d = 0; d < 60; d++) state.load[id][d] = Math.floor(br() * opts.background * m.cap); }
  }
  for (const s of order) {
    const rnd = mulberry32(hash(seed, run, s.id));
    let ready = plan.t0 || 0, why = null;
    for (const d of s.deps) if (fin[d] > ready) { ready = fin[d]; why = d; }
    start[s.id] = ready; cause[s.id] = why;
    let t = ready;
    const agent = s.agent ? lognormal(rnd, s.agent.median, s.agent.sigma) : 0;
    t += agent; // agents run around the clock
    let r = 0;
    if (s.approver && s.approver !== 'grady') {
      const ids = typeof s.approver === 'string' ? [s.approver] : s.approver.group;
      const rr = mulberry32(hash(seed, run, s.id, 'rej'));
      const pRej = opts.fixedReject != null ? opts.fixedReject : opts.truth ? ids.reduce((a, id) => a + plan.people[id].true.reject, 0) / ids.length : betaSample(rr, ...rejParams(plan, ids));
      for (;;) {
        r++;
        let best = Infinity;
        for (const id of ids) {
          const m = plan.people[id];
          if (opts.unplanned) { // ground-truth only: surprise days off, not in the PTO calendar
            if (!unplannedOff[id]) { const ur = mulberry32(hash(seed, run, 'off', id)); unplannedOff[id] = new Set(); for (let d = 0; d < 60; d++) if (ur() < opts.unplanned) unplannedOff[id].add(d); }
          }
          const st = Object.assign(Object.create(null), state, { reviewMult: (r > 1 ? 0.6 : 1) * (s.reviewMult || 1) });
          const tt = reviewBy(m, t, mulberry32(hash(seed, run, s.id, id, r)), st, opts.unplanned ? unplannedOff[id] : null);
          if (tt < best) best = tt;
        }
        t = best;
        if (r >= 4 || rr() >= pRej) break;
        t += lognormal(rr, (s.agent?.median || 1) * 0.35, 0.5); // agent rework
      }
    } else if (s.approver === 'grady') t += lognormal(rnd, 0.25, 0.4);
    fin[s.id] = t; rounds[s.id] = r;
  }
  const end = Math.max(...order.map(s => fin[s.id]));
  const last = order.find(s => fin[s.id] === end);
  const crit = [];
  for (let c = last; c; c = cause[c.id] ? plan.steps.find(x => x.id === cause[c.id]) : null) crit.push(c.id);
  return { fin, start, end, crit, rounds };
}

function rejParams(plan, ids) {
  // a group decision rejects at roughly the members' pooled rate
  let a = 0, b = 0;
  for (const id of ids) { a += plan.people[id].rejA - 1; b += plan.people[id].rejB - 1; }
  return [1 + a / ids.length, 1 + b / ids.length];
}

export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - w) / d, (c + w) / d];
}

export function forecast(plan, { runs = 2000, seed = 1, opts = {} } = {}) {
  const ends = [], critCount = {}, waitSum = {}, roundsSum = {};
  let onTime = 0;
  for (const s of plan.steps) { critCount[s.id] = 0; waitSum[s.id] = 0; roundsSum[s.id] = 0; }
  const perRun = [], stepFin = {};
  for (const s of plan.steps) stepFin[s.id] = [];
  for (let i = 0; i < runs; i++) {
    const r = simulateOnce(plan, i, seed, opts);
    for (const s of plan.steps) stepFin[s.id].push(r.fin[s.id]);
    ends.push(r.end);
    const ok = r.end <= plan.launch;
    onTime += ok; perRun.push(ok ? 1 : 0);
    for (const id of r.crit) critCount[id]++;
    for (const s of plan.steps) { waitSum[s.id] += r.fin[s.id] - r.start[s.id]; roundsSum[s.id] += r.rounds[s.id]; }
  }
  const sorted = [...ends].sort((a, b) => a - b);
  return {
    runs, p: onTime / runs, ci: wilson(onTime, runs), perRun,
    p50: quantile(sorted, 0.5), p80: quantile(sorted, 0.8), p95: quantile(sorted, 0.95), ends: sorted,
    criticality: Object.fromEntries(Object.entries(critCount).map(([k, v]) => [k, v / runs])),
    meanDuration: Object.fromEntries(Object.entries(waitSum).map(([k, v]) => [k, v / runs])),
    meanRounds: Object.fromEntries(Object.entries(roundsSum).map(([k, v]) => [k, v / runs])),
    stepP50: Object.fromEntries(Object.entries(stepFin).map(([k, v]) => [k, quantile(v.sort((a, b) => a - b), 0.5)])),
    stepP80: Object.fromEntries(Object.entries(stepFin).map(([k, v]) => [k, quantile(v, 0.8)])),
  };
}

// Deterministic roll-up: what a calendar of due dates implies if every step takes its median.
export function medianRollup(plan) {
  const fin = {};
  for (const s of topo(plan.steps)) {
    let t = Math.max(plan.t0 || 0, ...s.deps.map(d => fin[d]));
    if (s.agent) t += s.agent.median;
    if (s.approver && s.approver !== 'grady') {
      const ids = typeof s.approver === 'string' ? [s.approver] : s.approver.group;
      t = Math.min(...ids.map(id => { const m = plan.people[id]; return addWorkingHours(nextWorkingStart(t, m), quantile(m.lat, 0.5) * (s.reviewMult || 1), m); }));
    } else if (s.approver === 'grady') t += 0.25;
    fin[s.id] = t;
  }
  return Math.max(...Object.values(fin));
}

// ------------------------------------------------------------------ actions (what-if)
export function applyAction(plan, a) {
  const p = { ...plan, steps: plan.steps.map(s => ({ ...s, deps: [...s.deps] })), people: plan.people };
  delete p._order;
  const s = p.steps.find(x => x.id === a.step);
  if (a.type === 'approver') s.approver = a.to;
  if (a.type === 'launch') p.launch = a.to;
  if (a.type === 'early-review') { // review drafts in parallel with the upstream build; more rework
    s.deps = s.deps.filter(d => d !== a.dep); s.reviewMult = (s.reviewMult || 1) * 1.15;
    s.earlyFrom = a.dep;
  }
  if (a.type === 'split') { // split a batch: first wave unblocks downstream sooner
    s.agent = { ...s.agent, median: s.agent.median * 0.5 };
  }
  return p;
}

// Common random numbers: the same seed drives baseline and variant run-by-run, so the
// paired difference has far less noise than two independent forecasts.
export function compareActions(plan, actions, { runs = 1500, seed = 7 } = {}) {
  const base = forecast(plan, { runs, seed });
  return actions.map(a => {
    const v = forecast(applyAction(plan, a), { runs, seed });
    const d = v.perRun.map((x, i) => x - base.perRun[i]);
    const mean = d.reduce((s, x) => s + x, 0) / runs;
    const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (runs - 1));
    const half = 1.96 * sd / Math.sqrt(runs);
    return { action: a, p: v.p, delta: mean, ci: [mean - half, mean + half], p80: v.p80, significant: mean - half > 0 };
  }).sort((x, y) => y.delta - x.delta);
}

// ------------------------------------------------------------------ calibration
export function calibration(preds, outcomes, bins = 5) {
  const out = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const idx = preds.map((p, i) => [p, i]).filter(([p]) => p >= lo && (p < hi || (b === bins - 1 && p <= 1)));
    if (!idx.length) continue;
    const mp = idx.reduce((s, [p]) => s + p, 0) / idx.length;
    const mo = idx.reduce((s, [, i]) => s + outcomes[i], 0) / idx.length;
    out.push({ lo, hi, n: idx.length, predicted: mp, observed: mo });
  }
  const brier = preds.reduce((s, p, i) => s + (p - outcomes[i]) ** 2, 0) / preds.length;
  const ece = out.reduce((s, b) => s + b.n * Math.abs(b.predicted - b.observed), 0) / preds.length;
  return { bins: out, brier, ece };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as F from '../src/forecast.js';
import * as S from '../src/scenario.js';

const P = { id: 'p', tz: 0, cap: 0 };
const flatPerson = (id, hours, extra = {}) => ({ id, name: id, tz: 0, cap: 0, lat: [hours], rejA: 1, rejB: 1e9, n: 1, ...extra });

test('working hours: Friday 17:00 + 2 h lands Monday 10:00', () => {
  const fri17 = 4 * 24 + 17;
  assert.equal(F.addWorkingHours(fri17, 2, P), 7 * 24 + 10);
});

test('time zones: a Pacific reviewer (ET-3) starts at 12:00 ET', () => {
  assert.equal(F.nextWorkingStart(0, { tz: -3 }), 12);
  assert.equal(F.nextWorkingStart(0, { tz: 0 }), 9);
});

test('PTO days are skipped', () => {
  const t = F.addWorkingHours(9, 1, { tz: 0, pto: [0] }); // out Monday
  assert.equal(t, 24 + 10);
});

test('workingHoursBetween inverts addWorkingHours', () => {
  const r = F.mulberry32(3);
  for (let k = 0; k < 50; k++) { const a = Math.floor(r() * 400) / 4, h = Math.floor(r() * 120) / 4; assert.equal(F.workingHoursBetween(a, F.addWorkingHours(a, h, P), P), h); }
});

test('deterministic chain: agent + review times add up along dependencies', () => {
  const plan = { t0: 9, launch: 100, people: { a: flatPerson('a', 2) }, steps: [
    { id: 'x', deps: [], agent: { median: 1, sigma: 0 }, approver: 'a' },
    { id: 'y', deps: ['x'], agent: { median: 1, sigma: 0 }, approver: 'a' }] };
  const r = F.simulateOnce(plan, 0, 1, { fixedReject: 0 });
  // jitter on bootstrap is lognormal(0.15); bound it
  assert.ok(r.fin.x > 11.5 && r.fin.x < 13, `x=${r.fin.x}`);
  assert.ok(r.fin.y > r.fin.x + 2.5);
  assert.deepEqual(r.crit, ['y', 'x']);
});

test('a group approver is never slower than any single member (same random numbers)', () => {
  const base = S.demoPlan();
  const solo = F.forecast(base, { runs: 300, seed: 5 });
  const grp = F.forecast(F.applyAction(base, S.CANDIDATE_ACTIONS[0]), { runs: 300, seed: 5 });
  assert.ok(grp.p >= solo.p, `${grp.p} < ${solo.p}`);
  assert.ok(grp.p50 <= solo.p50);
});

test('PROPERTY: later launch dates never lower the on-time probability (common random numbers)', () => {
  const base = S.demoPlan();
  let prev = -1;
  for (const L of [6, 8, 9, 10, 12, 15].map(d => d * 24 + 13)) {
    const f = F.forecast({ ...base, launch: L }, { runs: 400, seed: 9 });
    assert.ok(f.p >= prev, `P dropped at ${L}`);
    prev = f.p;
  }
});

test('PROPERTY: random DAGs: finish >= every dependency finish and the critical path is a chain of dependencies', () => {
  const rnd = F.mulberry32(77);
  for (let k = 0; k < 60; k++) {
    const n = 3 + Math.floor(rnd() * 7);
    const steps = [];
    for (let i = 0; i < n; i++) {
      const deps = []; for (let j = 0; j < i; j++) if (rnd() < 0.35) deps.push('s' + j);
      steps.push({ id: 's' + i, deps, agent: { median: 0.5 + rnd() * 4, sigma: 0.3 }, approver: rnd() < 0.5 ? 'a' : 'grady' });
    }
    const plan = { t0: 0, launch: 200, people: { a: { id: 'a', tz: 0, cap: 2, lat: [1, 3, 8], rejA: 2, rejB: 6, n: 3 } }, steps };
    const r = F.simulateOnce(plan, k, 1);
    for (const s of steps) for (const d of s.deps) assert.ok(r.fin[s.id] >= r.fin[d]);
    for (let i = 0; i + 1 < r.crit.length; i++) assert.ok(steps.find(s => s.id === r.crit[i]).deps.includes(r.crit[i + 1]));
    assert.equal(r.end, Math.max(...Object.values(r.fin)));
  }
});

test('daily capacity: a reviewer with cap 1 cannot clear three reviews in one day', () => {
  const plan = { t0: 9, launch: 999, people: { a: { id: 'a', tz: 0, cap: 1, lat: [0.5], rejA: 1, rejB: 1e9, n: 1 } }, steps: ['x', 'y', 'z'].map(id => ({ id, deps: [], agent: { median: 0.1, sigma: 0 }, approver: 'a' })) };
  const r = F.simulateOnce(plan, 0, 1, { fixedReject: 0 });
  const days = new Set(Object.values(r.fin).map(t => Math.floor(t / 24)));
  assert.equal(days.size, 3);
});

test('rework: more rejections mean more review rounds and later finishes', () => {
  const mk = rej => ({ t0: 9, launch: 999, people: { a: { id: 'a', tz: 0, cap: 0, lat: [2, 4, 6], rejA: 1, rejB: 1, n: 3 } }, steps: [{ id: 'x', deps: [], agent: { median: 1, sigma: 0.2 }, approver: 'a' }] });
  const lo = F.forecast(mk(), { runs: 400, seed: 2, opts: { fixedReject: 0.05 } });
  const hi = F.forecast(mk(), { runs: 400, seed: 2, opts: { fixedReject: 0.6 } });
  assert.ok(hi.meanRounds.x > lo.meanRounds.x + 0.5);
  assert.ok(hi.p50 > lo.p50);
});

test('Wilson interval and calibration helpers', () => {
  const [a, b] = F.wilson(50, 100);
  assert.ok(Math.abs(a - 0.4038) < 1e-3 && Math.abs(b - 0.5962) < 1e-3);
  const c = F.calibration([0.1, 0.1, 0.9, 0.9], [0, 0, 1, 1], 5);
  assert.ok(Math.abs(c.brier - 0.01) < 1e-9);
  assert.equal(c.bins.length, 2);
});

test('paired comparison: the CI is narrower than two independent forecasts would give', () => {
  const plan = S.demoPlan();
  const [r] = F.compareActions(plan, [S.CANDIDATE_ACTIONS[0]], { runs: 800, seed: 3 });
  const indepHalf = 1.96 * Math.sqrt(2 * 0.25 / 800);
  assert.ok((r.ci[1] - r.ci[0]) / 2 < indepHalf, 'common random numbers should shrink the interval');
  assert.ok(r.significant && r.delta > 0.15);
});

test('history is generated from the hidden truth and Legal is the slowest reviewer', () => {
  const m = S.peopleModels(S.makeHistory());
  const med = id => F.quantile(m[id].lat, 0.5);
  assert.ok(med('maya') > med('henry') * 2);
  assert.equal(m.maya.n, 120);
});

test('HEADLINE: committed results match a fresh backtest and scenario run', async () => {
  const { runBacktest } = await import('../scripts/backtest.mjs');
  const bt = runBacktest();
  const committed = JSON.parse(fs.readFileSync(new URL('../results/summary.json', import.meta.url), 'utf8'));
  assert.equal(bt.rollup.late_called_on_time, committed.backtest.rollup.late_called_on_time);
  assert.equal(bt.rollup.late_total, committed.backtest.rollup.late_total);
  assert.equal(bt.forecast_late_flagged.late_with_p_below_half, committed.backtest.forecast_late_flagged.late_with_p_below_half);
  assert.equal(+bt.ece.toFixed(4), committed.backtest.ece);
  const f = F.forecast(S.demoPlan(), { runs: 2000, seed: 1 });
  assert.equal(+f.p.toFixed(4), committed.scenario.p_on_time);
});

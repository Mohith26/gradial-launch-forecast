// Backtest: 400 simulated past campaigns. For each, forecast P(on time) at kickoff from the
// approvers' history, then play the campaign out once under the hidden ground truth (Friday
// slowdowns, surprise days off, other campaigns competing for reviewers) and compare.
import fs from 'node:fs';
import { forecast, simulateOnce, medianRollup, calibration, hash, mulberry32, compareActions, applyAction, wilson } from '../src/forecast.js';
import { makeHistory, peopleModels, makeCampaign, demoPlan, CANDIDATE_ACTIONS, LAUNCH, START_DATE } from '../src/scenario.js';

export function runBacktest({ n = 400, runs = 400, seed = 11 } = {}) {
  const history = makeHistory();
  const models = peopleModels(history);
  const rnd = mulberry32(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const plan = makeCampaign(rnd, models);
    const f = forecast(plan, { runs, seed: hash('fc', i) });
    const truth = simulateOnce(plan, 0, hash('truth', seed, i), { truth: true, unplanned: 0.03, background: 0.5 });
    rows.push({ p: f.p, onTime: truth.end <= plan.launch ? 1 : 0, rollupOnTime: medianRollup(plan) <= plan.launch ? 1 : 0 });
  }
  const cal = calibration(rows.map(r => r.p), rows.map(r => r.onTime), 5);
  const late = rows.filter(r => !r.onTime);
  const rollupBrier = rows.reduce((s, r) => s + (r.rollupOnTime - r.onTime) ** 2, 0) / n;
  return {
    n, runs_per_forecast: runs, observed_on_time: rows.filter(r => r.onTime).length,
    calibration: cal.bins.map(b => ({ ...b, predicted: +b.predicted.toFixed(4), observed: +b.observed.toFixed(4) })),
    brier: +cal.brier.toFixed(4), ece: +cal.ece.toFixed(4),
    rollup: { brier: +rollupBrier.toFixed(4), late_called_on_time: late.filter(r => r.rollupOnTime).length, late_total: late.length, late_called_on_time_rate: +(late.filter(r => r.rollupOnTime).length / late.length).toFixed(4) },
    forecast_late_flagged: { late_with_p_below_half: late.filter(r => r.p < 0.5).length, rate: +(late.filter(r => r.p < 0.5).length / late.length).toFixed(4) },
    rows: rows.map(r => [+r.p.toFixed(4), r.onTime, r.rollupOnTime]),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  const bt = runBacktest();
  const plan = demoPlan();
  const f = forecast(plan, { runs: 2000, seed: 1 });
  const cmp = compareActions(plan, CANDIDATE_ACTIONS, { runs: 1500, seed: 7 });
  const best2 = applyAction(applyAction(plan, CANDIDATE_ACTIONS[0]), CANDIDATE_ACTIONS[1]);
  const f2 = forecast(best2, { runs: 2000, seed: 1 });
  const summary = {
    scenario: { start: START_DATE, launch_hours: LAUNCH, p_on_time: +f.p.toFixed(4), ci95: f.ci.map(x => +x.toFixed(4)), p50_hours: +f.p50.toFixed(2), p80_hours: +f.p80.toFixed(2), median_rollup_hours: +medianRollup(plan).toFixed(2),
      actions: cmp.map(c => ({ action: c.action.short, p: +c.p.toFixed(4), delta: +c.delta.toFixed(4), ci95: c.ci.map(x => +x.toFixed(4)), significant: c.significant })),
      p_after_top_two: +f2.p.toFixed(4) },
    backtest: { ...bt, rows: undefined },
    runtime_ms: Date.now() - t0,
  };
  fs.mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('../results/summary.json', import.meta.url), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(new URL('../results/backtest.json', import.meta.url), JSON.stringify(bt) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

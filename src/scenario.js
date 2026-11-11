// Seeded synthetic workspace: approvers (with hidden "true" behaviour), their review history
// generated from that truth, the demo campaign workflow, and the backtest campaign generator.
// Assumptions, not Gradial data: latencies are in working hours; medians 5-14 h; legal is
// slow and heavy-tailed; reviews that land on a Friday take 1.6x longer; ~3% surprise days off;
// other campaigns use up to half of each reviewer's daily capacity.
import { mulberry32, hash, lognormal, nextWorkingStart, addWorkingHours, workingHoursBetween, truthLatency, personModel, DAY } from './forecast.js';

export const START_DATE = '2026-11-09'; // Monday; t = 0 is 00:00 ET that day
export const PEOPLE = [
  { id: 'henry', name: 'Henry Hopcraft', role: 'Web Lead', tz: 0, cap: 6, true: { median: 5, sigma: 0.7, reject: 0.12 } },
  { id: 'priya', name: 'Priya Natarajan', role: 'Lifecycle Marketing', tz: -1, cap: 6, true: { median: 4.5, sigma: 0.6, reject: 0.1 } },
  { id: 'maya', name: 'Maya Chen', role: 'Legal', tz: -3, cap: 3, true: { median: 14, sigma: 1.0, reject: 0.28 }, pto: [2, 3] },
  { id: 'ana', name: 'Ana Ruiz', role: 'Legal', tz: 0, cap: 3, true: { median: 10, sigma: 0.9, reject: 0.24 } },
  { id: 'sam', name: 'Sam Ortiz', role: 'Brand Manager', tz: 0, cap: 4, true: { median: 9, sigma: 0.9, reject: 0.2 } },
  { id: 'kenji', name: 'Kenji Sato', role: 'Brand Manager', tz: -3, cap: 4, true: { median: 7, sigma: 0.8, reject: 0.18 } },
  { id: 'jonas', name: 'Jonas Weber', role: 'Localization Lead', tz: 6, cap: 5, true: { median: 6, sigma: 0.7, reject: 0.15 } },
];
export const GROUPS = { legal: { name: 'Legal Reviewers', members: ['maya', 'ana'] }, brand: { name: 'Brand Managers', members: ['sam', 'kenji'] } };

// Each person's last 8 weeks of review decisions, as Gradial's activity feed would record them:
// request time, decision time, approve/reject. Latency is counted in their scheduled working hours.
export function makeHistory(seed = 2026, n = 120) {
  const hist = {};
  for (const p of PEOPLE) {
    const rnd = mulberry32(hash(seed, 'hist', p.id));
    hist[p.id] = [];
    for (let i = 0; i < n; i++) {
      const arrive = -56 * DAY + rnd() * 55 * DAY;
      const begin = nextWorkingStart(arrive, p);
      let lat = truthLatency(rnd, p, begin);
      let done = addWorkingHours(begin, lat, p);
      if (rnd() < 0.03 * Math.max(1, lat / 9)) done += DAY; // a surprise day off stretches the wait
      hist[p.id].push({ requested: +arrive.toFixed(2), decided: +done.toFixed(2), hours: +workingHoursBetween(arrive, done, p).toFixed(2), rejected: rnd() < p.true.reject });
    }
  }
  return hist;
}

export function peopleModels(history) {
  const out = {};
  for (const p of PEOPLE) out[p.id] = personModel(p, history);
  return out;
}

export const STEPS = [
  { id: 's1', name: 'Qualify High-Intent Audience', deps: [], agent: { median: 0.6, sigma: 0.4 }, approver: 'grady', artifacts: 1 },
  { id: 's2', name: 'Build Web Variants', deps: ['s1'], agent: { median: 5, sigma: 0.35 }, approver: 'henry', artifacts: 24 },
  { id: 's3', name: 'Build Email Variants', deps: ['s1'], agent: { median: 2, sigma: 0.35 }, approver: 'priya', artifacts: 6 },
  { id: 's4', name: 'Localize Web Variants (DE, FR, JA)', deps: ['s2'], agent: { median: 6, sigma: 0.4 }, approver: 'jonas', artifacts: 72 },
  { id: 's5', name: 'Legal & Compliance Review', deps: ['s2', 's3'], agent: { median: 0.5, sigma: 0.3 }, approver: 'maya', artifacts: 0 },
  { id: 's6', name: 'Brand QA', deps: ['s4'], agent: { median: 1.5, sigma: 0.4 }, approver: 'sam', artifacts: 0 },
  { id: 's7', name: 'Accessibility Check', deps: ['s4'], agent: { median: 1, sigma: 0.3 }, approver: 'grady', artifacts: 0 },
  { id: 's8', name: 'Orchestrate SFMC Journey', deps: ['s3', 's5'], agent: { median: 3, sigma: 0.35 }, approver: 'priya', artifacts: 17 },
  { id: 's9', name: 'Publish to AEM', deps: ['s5', 's6', 's7'], agent: { median: 1, sigma: 0.3 }, approver: 'henry', artifacts: 96 },
  { id: 's10', name: 'Verify Campaign and Build Review', deps: ['s8', 's9'], agent: { median: 1, sigma: 0.3 }, approver: 'henry', artifacts: 1 },
];
export const LAUNCH = 9 * DAY + 13; // Wednesday Nov 18, 13:00 ET (go-live slot)

export function demoPlan(history = makeHistory()) {
  return { t0: 9, launch: LAUNCH, steps: STEPS.map(s => ({ ...s, deps: [...s.deps] })), people: peopleModels(history) };
}

export const CANDIDATE_ACTIONS = [
  { type: 'approver', step: 's5', to: { group: GROUPS.legal.members }, label: 'Make Legal Reviewers the approver for Legal & Compliance Review', short: 'Legal Reviewers approve' },
  { type: 'approver', step: 's6', to: { group: GROUPS.brand.members }, label: 'Make Brand Managers the approver for Brand QA', short: 'Brand Managers approve' },
  { type: 'early-review', step: 's5', dep: 's2', label: 'Start legal review on drafts while web variants build', short: 'Legal reviews drafts early' },
  { type: 'split', step: 's2', label: 'Split Build Web Variants into two batches', short: 'Split web batch' },
  { type: 'split', step: 's4', label: 'Split localization into one batch per language', short: 'Split localization' },
];

// Random past campaigns for the backtest: different sizes, approvers and deadlines.
export function makeCampaign(rnd, people) {
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const scale = 0.5 + rnd() * 1.5;
  const steps = STEPS.map(s => ({ ...s, deps: [...s.deps], agent: { ...s.agent, median: s.agent.median * (s.id === 's2' || s.id === 's4' ? scale : 1) } }));
  steps.find(s => s.id === 's5').approver = rnd() < 0.3 ? { group: GROUPS.legal.members } : pick(['maya', 'ana']);
  steps.find(s => s.id === 's6').approver = rnd() < 0.3 ? { group: GROUPS.brand.members } : pick(['sam', 'kenji']);
  const startDow = Math.floor(rnd() * 5); // campaigns start on any weekday morning
  const t0 = startDow * DAY + 9;
  // PTO in the forecast window is known from calendars; vary who is out
  const ppl = {};
  for (const [id, m] of Object.entries(people)) ppl[id] = { ...m, pto: rnd() < 0.15 ? [startDow + 1 + Math.floor(rnd() * 5)] : [] };
  return { steps, people: ppl, t0, launch: t0 + (3 + rnd() * 10) * DAY };
}

import type { Run } from './history';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: number) => MONTHS[m];
export const monthShort = (m: number) => MONTHS[m].slice(0, 3).toUpperCase();

const timeOf = (r: Run) => r.elapsedSec ?? r.movingSec;

// Weeks start on Monday.
export const startOfWeek = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};
const shiftWeek = (w: number, n: number) => {
  const d = new Date(w);
  d.setDate(d.getDate() + 7 * n);
  return startOfWeek(d.getTime());
};

export type WeekTotal = { start: number; distanceM: number; elapsedSec: number; elevM: number; runs: number };
export const weeklyTotals = (runs: Run[], weeks = 12, now = Date.now()): WeekTotal[] => {
  const cur = startOfWeek(now);
  const out: WeekTotal[] = Array.from({ length: weeks }, (_, i) => ({
    start: shiftWeek(cur, -(weeks - 1 - i)),
    distanceM: 0,
    elapsedSec: 0,
    elevM: 0,
    runs: 0,
  }));
  for (const r of runs) {
    const w = out.find((x) => x.start === startOfWeek(r.startedAt));
    if (w) {
      w.distanceM += r.distanceM;
      w.elapsedSec += timeOf(r);
      w.elevM += r.elevGainM ?? 0;
      w.runs += 1;
    }
  }
  return out;
};

// Consecutive weeks with at least one run. The current week still counts if it has no run yet.
export const streak = (runs: Run[], now = Date.now()) => {
  const weeks = new Set(runs.map((r) => startOfWeek(r.startedAt)));
  let w = startOfWeek(now);
  if (!weeks.has(w)) w = shiftWeek(w, -1);
  let count = 0;
  let oldest = w;
  while (weeks.has(w)) {
    count++;
    oldest = w;
    w = shiftWeek(w, -1);
  }
  const activities = count ? runs.filter((r) => startOfWeek(r.startedAt) >= oldest).length : 0;
  return { weeks: count, activities };
};

export const monthGrid = (year: number, month: number): (number | null)[] => {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return cells;
};

const inMonth = (r: Run, year: number, month: number) => {
  const d = new Date(r.startedAt);
  return d.getFullYear() === year && d.getMonth() === month;
};
export const runDays = (runs: Run[], year: number, month: number) =>
  new Set(runs.filter((r) => inMonth(r, year, month)).map((r) => new Date(r.startedAt).getDate()));

export type MonthTotal = { runs: number; distanceM: number; elapsedSec: number; elevM: number };
export const monthTotals = (runs: Run[], year: number, month: number): MonthTotal => {
  const t = { runs: 0, distanceM: 0, elapsedSec: 0, elevM: 0 };
  for (const r of runs) {
    if (!inMonth(r, year, month)) continue;
    t.runs++;
    t.distanceM += r.distanceM;
    t.elapsedSec += timeOf(r);
    t.elevM += r.elevGainM ?? 0;
  }
  return t;
};

export const autoTitle = (t: number) => {
  const h = new Date(t).getHours();
  return `${h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night'} run`;
};
export const runTitle = (r: Run) => r.title?.trim() || autoTitle(r.startedAt);

export const fmtDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(Math.floor(sec % 60)).padStart(2, '0')}s`;
};

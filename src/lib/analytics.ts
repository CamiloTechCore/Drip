import type { Config, Deuda, Registro } from '../types';

/** Calendar arithmetic is UTC-only, so DST and the computer timezone cannot change a date. */
const DAY = 86_400_000;
const parse = (date: string): Date => new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
const iso = (date: Date): string => date.toISOString().slice(0, 10);
export const todayISO = (): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
export const addDays = (date: string, days: number): string => iso(new Date(parse(date).getTime() + days * DAY));
export const daysBetween = (start: string, end: string): number => Math.round((parse(end).getTime() - parse(start).getTime()) / DAY);
const monthStart = (date: string): string => `${date.slice(0, 7)}-01`;
const monthDate = (year: number, month: number, day = 1): string => {
  const max = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(year, month, Math.min(Math.max(day, 1), max))));
};
export const addMonths = (date: string, months: number): string => {
  const d = parse(date);
  return monthDate(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate());
};
const sum = (records: Registro[]): number => records.reduce((total, record) => total + record.monto, 0);
const round = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
export const filterRecords = (records: Registro[], start?: string, end?: string): Registro[] =>
  records.filter(record => !record.eliminado && (!start || record.fecha >= start) && (!end || record.fecha <= end));

export interface Totals {
  income: number; expenses: number; savings: number; debtPayments: number; available: number;
  unnecessary: number; fixed: number; variable: number;
}
export function getTotals(records: Registro[], start?: string, end?: string): Totals {
  const rows = filterRecords(records, start, end);
  const income = sum(rows.filter(row => row.tipo === 'ingreso'));
  const expenses = sum(rows.filter(row => row.tipo === 'gasto'));
  const debtPayments = sum(rows.filter(row => row.tipo === 'deuda_pago'));
  // Savings is income minus spending. Cash available also subtracts repayments,
  // without counting principal repayments a second time as consumption.
  return {
    income, expenses, savings: income - expenses, debtPayments, available: income - expenses - debtPayments,
    unnecessary: sum(rows.filter(row => row.tipo === 'gasto' && row.necesidad === 'innecesario')),
    fixed: sum(rows.filter(row => row.tipo === 'gasto' && row.subtipo === 'fijo')),
    variable: sum(rows.filter(row => row.tipo === 'gasto' && row.subtipo === 'variable')),
  };
}

export interface Cycle extends Totals {
  id: string; start: string; end: string; label: string; days: number; elapsedDays: number;
  spentPercent: number; dailyAverage: number; projection: number; availablePerDay: number;
}
export function inferSalaryPeriod(records: Registro[], today = todayISO()): 'quincenal' | 'mensual' | null {
  const dates = [...new Set(filterRecords(records, undefined, today)
    .filter(row => row.tipo === 'ingreso' && row.subtipo === 'sueldo' && row.monto > 0).map(row => row.fecha))].sort();
  if (dates.length < 2) return null;
  const gaps = dates.slice(1).map((date, index) => daysBetween(dates[index], date)).sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
  return median < 23 ? 'quincenal' : 'mensual';
}

/** Actual salary dates define historical cycles; only the last ending is estimated.
 * If a salary is late, its open cycle extends to the next estimated payday. */
export function getCycles(records: Registro[], config: Config, today = todayISO()): Cycle[] {
  const rows = filterRecords(records, undefined, today);
  const salaryDates = [...new Set(rows.filter(row => row.tipo === 'ingreso' && row.subtipo === 'sueldo' && row.monto > 0).map(row => row.fecha))].sort();
  const inferred = config.tipo_ciclo === 'auto' ? inferSalaryPeriod(rows, today) : null;
  let boundaries: string[];
  if (inferred && salaryDates.length >= 2) {
    boundaries = [...salaryDates];
    const anchor = salaryDates[salaryDates.length - 1];
    let step = 1;
    let next = inferred === 'mensual' ? addMonths(anchor, step) : addDays(anchor, 15 * step);
    while (next <= today) {
      step += 1;
      next = inferred === 'mensual' ? addMonths(anchor, step) : addDays(anchor, 15 * step);
    }
    boundaries.push(next);
  } else {
    const earliest = rows.reduce((date, row) => row.fecha < date ? row.fecha : date, today);
    const start = parse(addMonths(monthStart(earliest), -1));
    const end = addMonths(monthStart(today), 2);
    const candidates = new Set<string>();
    const cut = Math.max(1, Math.min(31, config.dia_corte));
    for (let offset = 0; ; offset += 1) {
      const date = monthDate(start.getUTCFullYear(), start.getUTCMonth() + offset, cut);
      if (date > end) break;
      candidates.add(date);
      // Semimonthly calendar: each monthly cut and 15 days afterwards.
      if (config.tipo_ciclo === 'quincenal') candidates.add(addDays(date, 15));
    }
    const all = [...candidates].sort();
    const beginning = Math.max(0, all.findIndex(date => date > earliest) - 1);
    const ending = all.findIndex(date => date > today);
    boundaries = all.slice(beginning, ending + 1);
  }
  return boundaries.slice(0, -1).map((start, index) => {
    const end = addDays(boundaries[index + 1], -1);
    const totals = getTotals(rows, start, end);
    const days = daysBetween(start, end) + 1;
    const elapsedDays = Math.max(1, Math.min(days, daysBetween(start, today) + 1));
    const dailyAverage = totals.expenses / elapsedDays;
    const remainingDays = Math.max(1, daysBetween(today < start ? start : today, end) + 1);
    return {
      ...totals, id: start, start, end, label: new Intl.DateTimeFormat('es-CO', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parse(start)),
      days, elapsedDays, spentPercent: totals.income > 0 ? totals.expenses / totals.income * 100 : 0,
      dailyAverage, projection: dailyAverage * days, availablePerDay: Math.max(0, totals.available) / remainingDays,
    };
  });
}

export const normalizeDescription = (text: string): string => text.toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[\p{N}\p{P}\p{S}]/gu, ' ').replace(/\s+/g, ' ').trim();

export interface ExpenseGroup { key: string; label: string; count: number; total: number; average: number; lastDate: string }
function groupedExpenses(records: Registro[], keyOf: (record: Registro) => string, labelOf: (record: Registro) => string): ExpenseGroup[] {
  const groups = new Map<string, ExpenseGroup>();
  records.forEach(record => {
    const key = keyOf(record);
    const group = groups.get(key) ?? { key, label: labelOf(record), count: 0, total: 0, average: 0, lastDate: record.fecha };
    group.count += 1;
    group.total += record.monto;
    group.average = group.total / group.count;
    if (record.fecha > group.lastDate) group.lastDate = record.fecha;
    groups.set(key, group);
  });
  return [...groups.values()].sort((a, b) => b.total - a.total);
}
export function getRepeatedExpenses(records: Registro[]): ExpenseGroup[] {
  return groupedExpenses(filterRecords(records).filter(row => row.tipo === 'gasto'),
    row => normalizeDescription(row.descripcion || row.categoria), row => row.descripcion || row.categoria)
    .filter(group => group.count >= 2).sort((a, b) => b.count - a.count || b.total - a.total);
}

export function getAntExpenses(records: Registro[], config: Config, today = todayISO()): {
  total: number; annualProjection: number; count: number; items: ExpenseGroup[]; records: Registro[];
} {
  const rows = filterRecords(records, addDays(today, -29), today)
    .filter(row => row.tipo === 'gasto' && row.subtipo === 'variable' && row.monto > 0 && row.monto <= config.umbral_hormiga);
  const descriptions = new Map<string, number>();
  const categories = new Map<string, number>();
  rows.forEach(row => {
    const key = normalizeDescription(row.descripcion);
    if (key) descriptions.set(key, (descriptions.get(key) ?? 0) + 1);
    categories.set(row.categoria, (categories.get(row.categoria) ?? 0) + 1);
  });
  const frequentDescription = (row: Registro): boolean => (descriptions.get(normalizeDescription(row.descripcion)) ?? 0) >= config.min_repeticiones_hormiga;
  const matches = rows.filter(row => frequentDescription(row) || (categories.get(row.categoria) ?? 0) >= config.min_repeticiones_hormiga);
  // One assignment per transaction avoids double-counting when BOTH rules match.
  const items = groupedExpenses(matches,
    row => frequentDescription(row) ? `descripcion:${normalizeDescription(row.descripcion)}` : `categoria:${row.categoria}`,
    row => frequentDescription(row) ? row.descripcion : row.categoria);
  const total = sum(matches);
  return { total, annualProjection: total * 12, count: matches.length, items, records: matches };
}

export interface NamedTotal { name: string; total: number; count: number }
export function getCategoryTotals(records: Registro[]): NamedTotal[] {
  return groupedExpenses(filterRecords(records).filter(row => row.tipo === 'gasto'), row => row.categoria, row => row.categoria)
    .map(group => ({ name: group.label, total: group.total, count: group.count }));
}
export function getTagTotals(records: Registro[]): NamedTotal[] {
  const groups = new Map<string, NamedTotal>();
  filterRecords(records).filter(row => row.tipo === 'gasto').forEach(row => {
    new Set(row.tags.split(',').map(tag => tag.trim().toLowerCase().replace(/^#+/, '')).filter(Boolean)).forEach(name => {
      const group = groups.get(name) ?? { name, total: 0, count: 0 };
      group.total += row.monto;
      group.count += 1;
      groups.set(name, group);
    });
  });
  // Multi-tag expenses legitimately appear in multiple tag totals.
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

export interface MonthlySummary extends Totals { month: string; label: string; salary: number; additional: number }
export function getMonthlySummary(records: Registro[]): MonthlySummary[] {
  const rows = filterRecords(records);
  const months = [...new Set(rows.map(row => row.fecha.slice(0, 7)))].sort();
  if (!months.length) return [];
  const summaries: MonthlySummary[] = [];
  for (let month = `${months[0]}-01`; month <= `${months[months.length - 1]}-01`; month = addMonths(month, 1)) {
    const selected = rows.filter(row => row.fecha.startsWith(month.slice(0, 7)));
    summaries.push({
      ...getTotals(selected), month: month.slice(0, 7),
      label: new Intl.DateTimeFormat('es-CO', { month: 'short', timeZone: 'UTC' }).format(parse(month)),
      salary: sum(selected.filter(row => row.tipo === 'ingreso' && row.subtipo === 'sueldo')),
      additional: sum(selected.filter(row => row.tipo === 'ingreso' && row.subtipo === 'adicional')),
    });
  }
  return summaries;
}

/** Null means growth has no finite baseline (previous = 0, current > 0). */
export const growthPercent = (current: number, previous: number): number | null =>
  previous === 0 ? (current === 0 ? 0 : null) : (current - previous) / Math.abs(previous) * 100;
export function getUnnecessaryGrowth(records: Registro[], start: string, end: string): { current: number; previous: number; percent: number | null } {
  const length = Math.max(1, daysBetween(start, end) + 1);
  const current = getTotals(records, start, end).unnecessary;
  const previous = getTotals(records, addDays(start, -length), addDays(start, -1)).unnecessary;
  return { current, previous, percent: growthPercent(current, previous) };
}

export interface DebtItem { id: string; name: string; balance: number; principal: number; interest: number; payments: number; payoffDate: string | null }
function debtAt(debt: Deuda, records: Registro[], date: string): Omit<DebtItem, 'payoffDate'> {
  if (debt.fecha_inicio > date) return { id: debt.id, name: debt.nombre, balance: 0, principal: 0, interest: 0, payments: 0 };
  const events = filterRecords(records, debt.fecha_inicio, date).filter(row => row.deuda_id === debt.id && (row.tipo === 'deuda_aumento' || row.tipo === 'deuda_pago'));
  type Event = { date: string; amount: number; kind: 'interest' | 'increase' | 'payment' };
  const timeline: Event[] = events.map(row => ({ date: row.fecha, amount: row.monto, kind: row.tipo === 'deuda_pago' ? 'payment' : 'increase' }));
  for (let month = 1; addMonths(debt.fecha_inicio, month) <= date; month += 1) {
    timeline.push({ date: addMonths(debt.fecha_inicio, month), amount: 0, kind: 'interest' });
  }
  const order = { interest: 0, increase: 1, payment: 2 };
  timeline.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
  let balance = debt.monto_inicial;
  let principal = debt.monto_inicial;
  let interest = 0;
  let payments = 0;
  timeline.forEach(event => {
    if (event.kind === 'interest') {
      const accrued = round(balance * Math.max(0, debt.tasa_interes_mensual) / 100);
      interest += accrued;
      balance += accrued;
    } else if (event.kind === 'increase') {
      principal += event.amount;
      balance += event.amount;
    } else {
      payments += event.amount;
      balance = Math.max(0, balance - event.amount);
    }
  });
  return { id: debt.id, name: debt.nombre, balance: round(balance), principal: round(principal), interest: round(interest), payments: round(payments) };
}

function estimatedPayoff(balance: number, debt: Deuda, today: string): string | null {
  if (balance <= 0) return today;
  const rate = Math.max(0, debt.tasa_interes_mensual) / 100;
  if (debt.cuota_minima <= 0 || debt.cuota_minima <= balance * rate) return null;
  const d = parse(today);
  let firstPayment = monthDate(d.getUTCFullYear(), d.getUTCMonth(), debt.dia_pago);
  if (firstPayment <= today) firstPayment = monthDate(d.getUTCFullYear(), d.getUTCMonth() + 1, debt.dia_pago);
  // Forward estimate assumes a full month's interest per future payment and a
  // constant minimum payment. It is intentionally conservative, not a bank quote.
  for (let month = 0; month < 600; month += 1) {
    balance = round(balance * (1 + rate) - debt.cuota_minima);
    if (balance <= 0) {
      const first = parse(firstPayment);
      return monthDate(first.getUTCFullYear(), first.getUTCMonth() + month, debt.dia_pago);
    }
  }
  return null;
}

export interface DebtSummary {
  balance: number; principal: number; interest: number; payments: number; growthPercent: number | null;
  payoffDate: string | null; items: DebtItem[]; history: Array<{ date: string; balance: number; interest: number; payments: number }>;
}
export function getDebtSummary(debts: Deuda[], records: Registro[], today = todayISO()): DebtSummary {
  // Archived debts retain their balance/history; disabling a template cannot erase money owed.
  const known = debts.filter(debt => debt.fecha_inicio <= today);
  const items = known.map(debt => {
    const item = debtAt(debt, records, today);
    return { ...item, payoffDate: estimatedPayoff(item.balance, debt, today) };
  });
  const aggregate = (date: string) => known.reduce((total, debt) => {
    const item = debtAt(debt, records, date);
    return { balance: round(total.balance + item.balance), interest: round(total.interest + item.interest), payments: round(total.payments + item.payments) };
  }, { balance: 0, interest: 0, payments: 0 });
  const history: DebtSummary['history'] = [];
  if (known.length) {
    const earliest = known.map(debt => monthStart(debt.fecha_inicio)).sort()[0];
    for (let month = earliest; month <= today; month = addMonths(month, 1)) {
      const end = addDays(addMonths(month, 1), -1);
      const date = end < today ? end : today;
      history.push({ date, ...aggregate(date) });
    }
  }
  const current = aggregate(today);
  const previous = aggregate(addDays(monthStart(today), -1)).balance;
  const outstanding = items.filter(item => item.balance > 0);
  const payoffDate = outstanding.some(item => item.payoffDate === null) ? null
    : outstanding.map(item => item.payoffDate ?? today).sort().at(-1) ?? (items.length ? today : null);
  return { ...current, principal: items.reduce((total, item) => total + item.principal, 0),
    growthPercent: growthPercent(current.balance, previous), payoffDate, items, history };
}

const breaksStreak = (record: Registro, config: Config): boolean => record.monto > 0 &&
  ((record.tipo === 'gasto' && (record.subtipo === 'variable' || !config.excluir_fijos_de_racha)) ||
    (record.tipo === 'deuda_pago' && !config.excluir_fijos_de_racha));
const mondayOf = (date: string): string => addDays(date, -((parse(date).getUTCDay() + 6) % 7));
export interface Streaks {
  current: number; best: number; confirmedDays: string[]; badges: number[];
  weekly: number; weeklyReductionPercent: number; weeklyBadges: number[]; message: string;
}
export function getStreaks(records: Registro[], config: Config, today = todayISO()): Streaks {
  const rows = filterRecords(records, undefined, today);
  const empty: Streaks = { current: 0, best: 0, confirmedDays: [], badges: [], weekly: 0, weeklyReductionPercent: 0, weeklyBadges: [], message: 'Tu primer registro es el comienzo de un buen hábito.' };
  if (!rows.length) return empty;
  const firstDay = rows.map(row => row.fecha).sort()[0];
  const spendingDays = [...new Set(rows.filter(row => breaksStreak(row, config)).map(row => row.fecha))].sort();
  let previousSpend = addDays(firstDay, -1);
  let best = 0;
  spendingDays.forEach(date => { best = Math.max(best, daysBetween(previousSpend, date) - 1); previousSpend = date; });
  const current = Math.max(0, daysBetween(previousSpend, today));
  best = Math.max(best, current);
  const confirmedDays = [...new Set(rows.filter(row => row.tipo === 'sin_gasto' && !spendingDays.includes(row.fecha)).map(row => row.fecha))].sort();
  // Compare only fully observed, completed Monday–Sunday weeks. A partial first
  // week and the current unfinished week cannot earn or break a weekly badge.
  let firstMonday = mondayOf(firstDay);
  if (firstMonday < firstDay) firstMonday = addDays(firstMonday, 7);
  const currentMonday = mondayOf(today);
  const weeks: number[] = [];
  for (let monday = firstMonday; monday < currentMonday; monday = addDays(monday, 7)) {
    weeks.push(getTotals(rows, monday, addDays(monday, 6)).variable);
  }
  let weekly = 0;
  const target = Math.max(0, config.meta_reduccion_semanal_pct);
  for (let index = weeks.length - 1; index > 0; index -= 1) {
    const previous = weeks[index - 1];
    const value = weeks[index];
    if (!(value < previous && previous > 0 && (previous - value) / previous * 100 + 1e-9 >= target)) break;
    weekly += 1;
  }
  const baseline = weeks[weeks.length - weekly - 1];
  const weeklyReductionPercent = weekly && baseline > 0 ? (baseline - weeks[weeks.length - 1]) / baseline * 100 : 0;
  return { current, best, confirmedDays, badges: [3, 7, 14, 30, 60, 100].filter(days => best >= days),
    weekly, weeklyReductionPercent, weeklyBadges: [2, 4, 8, 12].filter(count => weekly >= count),
    message: current >= 7 ? 'Una semana de decisiones que suman. ¡Sigue así!'
      : current >= 3 ? 'Cada día cuenta. Tu próxima insignia está más cerca.'
        : current > 0 ? 'Un día a la vez, estás cuidando tu dinero.' : 'Hoy puede empezar una nueva racha.' };
}

export interface HeatmapDay { date: string; amount: number; status: 'future' | 'unknown' | 'clear' | 'small' | 'heavy'; confirmed: boolean }
export function getHeatmap(records: Registro[], config: Config, month = todayISO().slice(0, 7), today = todayISO()): HeatmapDay[] {
  const rows = filterRecords(records, undefined, today);
  const first = rows.map(row => row.fecha).sort()[0];
  const confirmed = new Set(getStreaks(rows, config, today).confirmedDays);
  const start = `${month.slice(0, 7)}-01`;
  const end = addMonths(start, 1);
  const result: HeatmapDay[] = [];
  for (let date = start; date < end; date = addDays(date, 1)) {
    const amount = sum(rows.filter(row => row.fecha === date && breaksStreak(row, config)));
    const status = date > today ? 'future' : !first || date < first ? 'unknown' : amount === 0 ? 'clear' : amount <= config.umbral_hormiga ? 'small' : 'heavy';
    result.push({ date, amount, status, confirmed: confirmed.has(date) });
  }
  return result;
}

export function getSpendingPatterns(records: Registro[]): {
  weekdays: Array<{ day: number; label: string; total: number }>; monthDays: Array<{ day: number; total: number }>;
} {
  const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((label, index) => ({ day: index + 1, label, total: 0 }));
  const monthDays = Array.from({ length: 31 }, (_, index) => ({ day: index + 1, total: 0 }));
  filterRecords(records).filter(row => row.tipo === 'gasto').forEach(row => {
    const date = parse(row.fecha);
    weekdays[(date.getUTCDay() + 6) % 7].total += row.monto;
    monthDays[date.getUTCDate() - 1].total += row.monto;
  });
  return { weekdays, monthDays };
}

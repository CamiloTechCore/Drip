import { describe, expect, it, vi } from 'vitest';
import type { Config, Deuda, Registro } from '../src/types';
import { DEFAULT_CONFIG } from '../src/lib/defaults';
import { createDemoData } from '../src/lib/demo';
import {
  addDays, addMonths, getAntExpenses, getCategoryTotals, getCycles, getDebtSummary, getHeatmap,
  getMonthlySummary, getRepeatedExpenses, getSpendingPatterns, getStreaks, getTagTotals,
  getTotals, getUnnecessaryGrowth, growthPercent, inferSalaryPeriod, normalizeDescription, todayISO,
  getSavingsStreak, isSavingsDeposit, isSavingsWithdrawal, isExpense, isIncome,
} from '../src/lib/analytics';

const cfg = (overrides: Partial<Config> = {}): Config => ({ ...DEFAULT_CONFIG, ...overrides });
let sequence = 0;
const record = (fecha: string, values: Partial<Registro> = {}): Registro => ({
  id: `test-${++sequence}`, fecha, tipo: 'gasto', subtipo: 'variable', monto: 10000,
  categoria: 'Comida fuera', tags: '', descripcion: 'Café', metodo_pago: 'efectivo',
  necesidad: 'innecesario', recurrente_id: '', deuda_id: '', creado_en: `${fecha}T12:00:00Z`,
  actualizado_en: `${fecha}T12:00:00Z`, eliminado: false, ...values,
});
const salary = (date: string, amount = 1000000): Registro => record(date, { tipo: 'ingreso', subtipo: 'sueldo', monto: amount, categoria: 'Sueldo', necesidad: '' });
const deposit = (date: string, amount: number, values: Partial<Registro> = {}): Registro =>
  record(date, { categoria: 'Ahorro', descripcion: 'Depósito a ahorro', tags: 'ahorro_deposito', monto: amount, ...values });
const withdrawal = (date: string, amount: number, values: Partial<Registro> = {}): Registro =>
  record(date, { tipo: 'ingreso', subtipo: 'adicional', categoria: 'Ingreso extra', descripcion: 'Retiro de ahorro', tags: 'ahorro_retiro', necesidad: '', monto: amount, ...values });
const debt: Deuda = { id: 'loan', nombre: 'Préstamo', acreedor: 'Ejemplo', monto_inicial: 1000,
  tasa_interes_mensual: 10, fecha_inicio: '2026-01-01', cuota_minima: 200, dia_pago: 1, activa: true };

describe('calendar dates and normalized descriptions', () => {
  it('uses the Bogota day even when UTC has passed midnight', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-01T03:59:00.000Z'));
      expect(todayISO()).toBe('2026-09-30');
    } finally { vi.useRealTimers(); }
  });
  it('preserves calendar dates across leap years, month ends and DST boundaries', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
  });
  it('merges spelling case, accents and receipt numbers', () => {
    expect(normalizeDescription('  CAFÉ #123 — Jóse 45! ')).toBe('cafe jose');
  });
});

describe('cash totals and salary cycles', () => {
  it('excludes deleted and out-of-range records and avoids treating debt increases as income', () => {
    const rows = [salary('2026-09-01', 1000), record('2026-09-02', { monto: 100 }),
      record('2026-09-03', { tipo: 'deuda_pago', monto: 200 }), record('2026-09-03', { tipo: 'deuda_aumento', monto: 300 }),
      record('2026-09-04', { eliminado: true, monto: 999 }), record('2026-08-31', { monto: 999 })];
    expect(getTotals(rows, '2026-09-01', '2026-09-30')).toMatchObject({ income: 1000, expenses: 300, savings: 700, debtPayments: 200, available: 700 });
  });
  it('uses distinct salary days and the median to infer biweekly periods', () => {
    const rows = [salary('2026-07-01'), salary('2026-07-01'), salary('2026-07-16'), salary('2026-08-01'), salary('2026-08-16')];
    expect(inferSalaryPeriod(rows, '2026-08-20')).toBe('quincenal');
    const cycles = getCycles(rows, cfg(), '2026-08-20');
    expect(cycles[0]).toMatchObject({ start: '2026-07-01', end: '2026-07-15', income: 2000000 });
    expect(cycles.at(-1)).toMatchObject({ start: '2026-08-16', end: '2026-08-30' });
  });
  it('bounds actual cycles by the next salary and computes projection from elapsed days', () => {
    const rows = [salary('2026-08-01'), salary('2026-09-01'), record('2026-09-02', { monto: 100000 }),
      record('2026-09-04', { tipo: 'deuda_pago', monto: 50000 }), salary('2026-10-01')];
    const cycles = getCycles(rows, cfg(), '2026-09-10');
    expect(cycles).toHaveLength(2);
    expect(cycles[1]).toMatchObject({ start: '2026-09-01', end: '2026-09-30', days: 30, elapsedDays: 10, dailyAverage: 15000, projection: 450000, spentPercent: 15 });
    expect(cycles[1].availablePerDay).toBeCloseTo(850000 / 21);
  });
  it('falls back to a clamped cut day and honors forced manual cycles', () => {
    const rows = [salary('2026-01-15'), salary('2026-02-15')];
    const cycles = getCycles(rows, cfg({ tipo_ciclo: 'mensual', dia_corte: 31 }), '2026-02-28');
    expect(cycles.at(-1)).toMatchObject({ start: '2026-02-28', end: '2026-03-30' });
    expect(getCycles([], cfg(), '2026-09-30')).toHaveLength(1);
    expect(getCycles([], cfg(), '2026-09-30')[0].income).toBe(0);
  });
  it('supports semimonthly calendar intervals through short months', () => {
    const cycles = getCycles([record('2026-02-01')], cfg({ tipo_ciclo: 'quincenal' }), '2026-02-27');
    expect(cycles.map(cycle => [cycle.start, cycle.end])).toEqual([['2026-02-01', '2026-02-15'], ['2026-02-16', '2026-02-28']]);
  });
});

describe('expense grouping and growth', () => {
  it('matches description OR category and counts each qualifying purchase only once', () => {
    const rows = [record('2026-09-01', { descripcion: 'Café 1' }), record('2026-09-02', { descripcion: 'cafe 2' }), record('2026-09-03', { descripcion: 'CAFÉ 3' }),
      record('2026-09-04', { descripcion: 'Pan' }), record('2026-09-05', { descripcion: 'Agua' }),
      record('2026-08-31'), record('2026-09-10', { subtipo: 'fijo' }), record('2026-10-01'), record('2026-09-11', { monto: 20001 })];
    const ants = getAntExpenses(rows, cfg(), '2026-09-30');
    expect(ants.count).toBe(5);
    expect(ants.total).toBe(50000);
    expect(ants.annualProjection).toBe(600000);
    expect(ants.items.reduce((total, item) => total + item.total, 0)).toBe(50000);
  });
  it('detects repeat descriptions across categories, with inclusive threshold and start date', () => {
    const rows = [record('2026-09-01', { monto: 20000, categoria: 'A' }), record('2026-09-15', { categoria: 'B' }), record('2026-09-30', { categoria: 'C' })];
    expect(getAntExpenses(rows, cfg(), '2026-09-30').total).toBe(40000);
    expect(getRepeatedExpenses(rows)[0]).toMatchObject({ count: 3, total: 40000, lastDate: '2026-09-30' });
  });
  it('compares equal-length inclusive windows rather than unequal calendar months', () => {
    const rows = [record('2026-08-30', { monto: 100 }), record('2026-08-31', { monto: 100 }), record('2026-09-01', { monto: 50 }), record('2026-09-02', { monto: 50 })];
    expect(getUnnecessaryGrowth(rows, '2026-09-01', '2026-09-02')).toEqual({ current: 100, previous: 200, percent: -50 });
    expect(growthPercent(10, 0)).toBeNull();
    expect(growthPercent(0, 0)).toBe(0);
  });
  it('deduplicates tags within each purchase but keeps meaningful overlaps', () => {
    const rows = [record('2026-09-01', { monto: 100, tags: 'café, Café, pareja' })];
    expect(getTagTotals(rows)).toEqual([{ name: 'café', total: 100, count: 1 }, { name: 'pareja', total: 100, count: 1 }]);
    expect(getCategoryTotals(rows)).toEqual([{ name: 'Comida fuera', total: 100, count: 1 }]);
  });
  it('includes empty intervening months and maps weekdays in Monday-first order', () => {
    const rows = [salary('2026-07-01', 1000), record('2026-09-07', { monto: 100 })];
    expect(getMonthlySummary(rows).map(month => month.expenses)).toEqual([0, 0, 100]);
    expect(getSpendingPatterns(rows).weekdays[0]).toEqual({ day: 1, label: 'Lun', total: 100 });
    expect(getSpendingPatterns(rows).monthDays[6].total).toBe(100);
  });
});

describe('debt balances and amortization', () => {
  it('charges interest on the chronological balance after earlier payments', () => {
    const rows = [record('2026-01-15', { tipo: 'deuda_pago', deuda_id: 'loan', monto: 500 })];
    const summary = getDebtSummary([debt], rows, '2026-03-01');
    expect(summary).toMatchObject({ balance: 605, interest: 105, payments: 500, principal: 1000 });
    expect(summary.history.map(point => point.balance)).toEqual([500, 550, 605]);
    expect(summary.growthPercent).toBeCloseTo(10);
  });
  it('handles same-day anniversary interest, new borrowing, and payment in that order', () => {
    const rows = [record('2026-02-01', { tipo: 'deuda_aumento', deuda_id: 'loan', monto: 300 }), record('2026-02-01', { tipo: 'deuda_pago', deuda_id: 'loan', monto: 400 })];
    expect(getDebtSummary([debt], rows, '2026-02-01')).toMatchObject({ balance: 1000, interest: 100, principal: 1300, payments: 400 });
  });
  it('ignores deleted and future payments and never shows negative debt', () => {
    const rows = [record('2026-01-02', { tipo: 'deuda_pago', deuda_id: 'loan', monto: 2000 }), record('2026-01-03', { tipo: 'deuda_aumento', deuda_id: 'loan', monto: 1000, eliminado: true }), record('2027-01-01', { tipo: 'deuda_aumento', deuda_id: 'loan', monto: 9999 })];
    expect(getDebtSummary([debt], rows, '2026-04-01')).toMatchObject({ balance: 0, interest: 0, payoffDate: '2026-04-01' });
  });
  it('reports unaffordable repayments as no estimated payoff, and handles zero interest', () => {
    expect(getDebtSummary([{ ...debt, cuota_minima: 50 }], [], '2026-01-01').payoffDate).toBeNull();
    expect(getDebtSummary([{ ...debt, tasa_interes_mensual: 0, cuota_minima: 500 }], [], '2026-01-01').payoffDate).toBe('2026-03-01');
    expect(getDebtSummary([], [], '2026-09-01')).toMatchObject({ balance: 0, interest: 0, history: [], payoffDate: null });
  });
  it('retains inactive debts and skips debts whose start date is in the future', () => {
    expect(getDebtSummary([{ ...debt, activa: false }, { ...debt, id: 'future', fecha_inicio: '2027-01-01' }], [], '2026-01-01').balance).toBe(1000);
  });
});

describe('no-spend streaks and weekly reductions', () => {
  it('counts unconfirmed days, ignores fixed payments by default, and records best history', () => {
    const rows = [salary('2026-09-01'), record('2026-09-08'), record('2026-09-09', { subtipo: 'fijo' }),
      record('2026-09-10', { tipo: 'deuda_pago' }), record('2026-09-11', { tipo: 'sin_gasto', monto: 0 })];
    expect(getStreaks(rows, cfg(), '2026-09-12')).toMatchObject({ current: 2, best: 7, confirmedDays: ['2026-09-11'], badges: [3, 7] });
    expect(getStreaks(rows, cfg({ excluir_fijos_de_racha: false }), '2026-09-12').current).toBe(2);
  });
  it('does not award days before the first observation or after today', () => {
    expect(getStreaks([], cfg(), '2026-09-12').current).toBe(0);
    expect(getStreaks([salary('2026-09-12')], cfg(), '2026-09-12').current).toBe(1);
    expect(getStreaks([record('2026-09-10'), record('2026-09-20')], cfg(), '2026-09-12').current).toBe(2);
  });
  it('lets an actual expense override a same-day no-spend confirmation', () => {
    const rows = [record('2026-09-12'), record('2026-09-12', { tipo: 'sin_gasto', monto: 0 })];
    expect(getStreaks(rows, cfg(), '2026-09-12')).toMatchObject({ current: 0, confirmedDays: [] });
  });
  it.each([true, false])('a debt payment ends the streak even when excluding fixed expenses is %s', excluir_fijos_de_racha => {
    const rows = [salary('2026-09-01'), record('2026-09-12', { tipo: 'sin_gasto', monto: 0 }), record('2026-09-12', { tipo: 'deuda_pago', monto: 100 })];
    const config = cfg({ excluir_fijos_de_racha });
    expect(getStreaks(rows, config, '2026-09-12')).toMatchObject({ current: 0, confirmedDays: [] });
    expect(getHeatmap(rows, config, '2026-09', '2026-09-12')[11].confirmed).toBe(false);
    expect(getStreaks(rows.slice(0, 2), config, '2026-09-12').current).toBe(12);
  });
  it('counts only completed fully observed weeks and requires a strict decrease', () => {
    const rows = [salary('2026-08-31'), record('2026-09-01', { monto: 100 }), record('2026-09-08', { monto: 80 }), record('2026-09-15', { monto: 60 }), record('2026-09-22', { monto: 9999 })];
    expect(getStreaks(rows, cfg({ meta_reduccion_semanal_pct: 20 }), '2026-09-23')).toMatchObject({ weekly: 2, weeklyReductionPercent: 40, weeklyBadges: [2] });
    expect(getStreaks(rows, cfg({ meta_reduccion_semanal_pct: 26 }), '2026-09-23').weekly).toBe(0);
    expect(getStreaks([salary('2026-08-31')], cfg(), '2026-09-23').weekly).toBe(0);
  });
  it('renders unknown and future days distinctly and honors confirmations', () => {
    const rows = [record('2026-09-10', { monto: 50000 }), record('2026-09-11', { tipo: 'sin_gasto', monto: 0 })];
    const heatmap = getHeatmap(rows, cfg(), '2026-09', '2026-09-12');
    expect(heatmap).toHaveLength(30);
    expect(heatmap[0].status).toBe('unknown');
    expect(heatmap[9].status).toBe('heavy');
    expect(heatmap[10]).toMatchObject({ status: 'clear', confirmed: true });
    expect(heatmap[11]).toMatchObject({ status: 'clear', confirmed: false });
    expect(heatmap[12].status).toBe('future');
  });
});

describe('debt repayments and explicit savings transfers', () => {
  it('classifies exact transfer tags with their direction, never category names or substrings', () => {
    expect(isSavingsDeposit(deposit('2026-09-01', 100, { tags: ' personal, AHORRO_DEPOSITO ' }))).toBe(true);
    expect(isSavingsWithdrawal(withdrawal('2026-09-02', 50))).toBe(true);
    expect(isSavingsDeposit(record('2026-09-01', { categoria: 'Ahorro', tags: 'sin_ahorro_deposito' }))).toBe(false);
    expect(isSavingsDeposit(salary('2026-09-01'))).toBe(false);
    expect(isSavingsDeposit(withdrawal('2026-09-01', 100, { tags: 'ahorro_deposito' }))).toBe(false);
    expect(isSavingsWithdrawal(deposit('2026-09-01', 100, { tags: 'ahorro_retiro' }))).toBe(false);
    expect(isExpense(record('2026-09-01', { tipo: 'deuda_pago' }))).toBe(true);
    expect(isExpense(deposit('2026-09-01', 100))).toBe(false);
    expect(isIncome(withdrawal('2026-09-01', 100))).toBe(false);
    expect(isIncome(salary('2026-09-01'))).toBe(true);
  });
  it('counts repayments exactly once across totals, cycles, months and expense breakdowns', () => {
    const rows = [salary('2026-09-01', 1000), record('2026-09-02', { monto: 100 }),
      record('2026-09-03', { tipo: 'deuda_pago', subtipo: '', monto: 200, categoria: 'Deudas', deuda_id: 'loan', tags: 'credito', descripcion: 'Abono tarjeta', necesidad: '' }),
      record('2026-09-04', { tipo: 'deuda_pago', subtipo: '', monto: 50, categoria: 'Deudas', deuda_id: 'loan', tags: 'credito', descripcion: 'Abono tarjeta', necesidad: '' }),
      deposit('2026-09-05', 300), withdrawal('2026-09-06', 80),
      record('2026-09-07', { tipo: 'ingreso', subtipo: 'adicional', monto: 20, categoria: 'Ingreso extra' }),
      record('2026-09-08', { tipo: 'deuda_aumento', monto: 999 }), deposit('2026-09-09', 999, { eliminado: true })];
    const snapshot = structuredClone(rows);
    const totals = { income: 1020, expenses: 350, savings: 670, debtPayments: 250, available: 450,
      savingsDeposits: 300, savingsWithdrawals: 80, fixed: 250, variable: 100, unnecessary: 100 };
    expect(getTotals(rows)).toEqual(totals);
    expect(getCycles(rows, cfg({ tipo_ciclo: 'mensual' }), '2026-09-30').at(-1)).toMatchObject(totals);
    expect(getMonthlySummary(rows)[0]).toMatchObject({ ...totals, salary: 1000, additional: 20 });
    expect(getCategoryTotals(rows)).toEqual([{ name: 'Deudas', total: 250, count: 2 }, { name: 'Comida fuera', total: 100, count: 1 }]);
    expect(getTagTotals(rows)).toEqual([{ name: 'credito', total: 250, count: 2 }]);
    expect(getRepeatedExpenses(rows)).toEqual([expect.objectContaining({ label: 'Abono tarjeta', count: 2, total: 250 })]);
    expect(getSpendingPatterns(rows).monthDays.reduce((total, day) => total + day.total, 0)).toBe(350);
    expect(getSpendingPatterns(rows).monthDays[4].total).toBe(0);
    expect(rows).toEqual(snapshot);
  });
  it('does not treat transfers as spending, unnecessary purchases, ant expenses or salary boundaries', () => {
    const rows = [salary('2026-08-31', 1000), deposit('2026-09-01', 10), deposit('2026-09-08', 20),
      deposit('2026-09-15', 30), withdrawal('2026-09-16', 5, { subtipo: 'sueldo' })];
    expect(getTotals(rows)).toMatchObject({ income: 1000, expenses: 0, unnecessary: 0, variable: 0, fixed: 0 });
    expect(getUnnecessaryGrowth(rows, '2026-09-01', '2026-09-23').current).toBe(0);
    expect(getAntExpenses(rows, cfg(), '2026-09-23').total).toBe(0);
    expect(getRepeatedExpenses(rows)).toEqual([]);
    expect(getCategoryTotals(rows)).toEqual([]);
    expect(getTagTotals(rows)).toEqual([]);
    expect(inferSalaryPeriod(rows, '2026-09-23')).toBeNull();
    expect(getStreaks(rows, cfg({ excluir_fijos_de_racha: false }), '2026-09-23')).toMatchObject({ current: 24, weekly: 0 });
    expect(getHeatmap(rows, cfg({ excluir_fijos_de_racha: false }), '2026-09', '2026-09-23')[14]).toMatchObject({ amount: 0, status: 'clear' });
  });
});

describe('days preserving savings', () => {
  it('starts with zero complete days and does not restart for further deposits', () => {
    const rows = [deposit('2026-09-01', 100), deposit('2026-09-05', 50)];
    expect(getSavingsStreak(rows, '2026-09-01')).toMatchObject({ balance: 100, current: 0, best: 0, startedAt: '2026-09-01' });
    expect(getSavingsStreak(rows, '2026-09-02').current).toBe(1);
    expect(getSavingsStreak(rows, '2026-09-08')).toEqual({ balance: 150, totalDeposits: 150, totalWithdrawals: 0,
      current: 7, best: 7, startedAt: '2026-09-01', lastWithdrawal: null, badges: [3, 7] });
  });
  it('resets on a partial withdrawal and preserves the longest completed interval', () => {
    const rows = [deposit('2026-09-01', 100), withdrawal('2026-09-10', 20), deposit('2026-09-12', 50)];
    expect(getSavingsStreak(rows, '2026-09-10')).toMatchObject({ balance: 80, current: 0, best: 9, startedAt: '2026-09-10', lastWithdrawal: '2026-09-10' });
    expect(getSavingsStreak(rows, '2026-09-14')).toMatchObject({ balance: 130, current: 4, best: 9, startedAt: '2026-09-10', badges: [3, 7] });
  });
  it('stops at a zero balance and starts a new interval after replenishing it', () => {
    const rows = [deposit('2026-09-01', 100), withdrawal('2026-09-10', 100), deposit('2026-09-15', 40)];
    expect(getSavingsStreak(rows, '2026-09-14')).toMatchObject({ balance: 0, current: 0, best: 9, startedAt: null });
    expect(getSavingsStreak(rows, '2026-09-18')).toMatchObject({ balance: 40, current: 3, best: 9, startedAt: '2026-09-15' });
  });
  it('keeps an overdrawn balance visible and waits until deposits restore a positive balance', () => {
    const rows = [deposit('2026-09-01', 100), withdrawal('2026-09-04', 150), deposit('2026-09-05', 30), deposit('2026-09-08', 25)];
    expect(getSavingsStreak(rows, '2026-09-06')).toMatchObject({ balance: -20, totalDeposits: 130, totalWithdrawals: 150, current: 0, best: 3, startedAt: null });
    expect(getSavingsStreak(rows, '2026-09-10')).toMatchObject({ balance: 5, current: 2, best: 3, startedAt: '2026-09-08' });
  });
  it('replays same-day transfers by capture time independently of input order', () => {
    const first = deposit('2026-09-01', 100);
    const morning = withdrawal('2026-09-08', 100, { creado_en: '2026-09-08T13:00:00.000Z' });
    const afternoon = deposit('2026-09-08', 30, { creado_en: '2026-09-08T17:00:00.000Z' });
    const rows = [afternoon, first, morning];
    const sameDay = getSavingsStreak(rows, '2026-09-08');
    expect(sameDay).toMatchObject({ balance: 30, current: 0, best: 7, startedAt: '2026-09-08', lastWithdrawal: '2026-09-08' });
    expect(getSavingsStreak([...rows].reverse(), '2026-09-08')).toEqual(sameDay);
    expect(getSavingsStreak(rows, '2026-09-09').current).toBe(1);
  });
  it('ignores deleted, future, untagged and zero transfers without mutating records', () => {
    const rows = [record('2026-08-01', { categoria: 'Ahorro', monto: 999 }), deposit('2026-09-01', 100),
      withdrawal('2026-09-03', 50, { eliminado: true }), withdrawal('2026-09-05', 0),
      withdrawal('2026-10-01', 100), deposit('2026-08-01', 999, { eliminado: true })];
    const snapshot = structuredClone(rows);
    expect(getSavingsStreak(rows, '2026-09-08')).toEqual({ balance: 100, totalDeposits: 100, totalWithdrawals: 0,
      current: 7, best: 7, startedAt: '2026-09-01', lastWithdrawal: null, badges: [3, 7] });
    expect(rows).toEqual(snapshot);
    expect(getSavingsStreak([], '2026-09-08')).toMatchObject({ balance: 0, current: 0, best: 0, startedAt: null, lastWithdrawal: null, badges: [] });
  });
  it('does not earn a streak from floating-point residue after a complete withdrawal', () => {
    const rows = [deposit('2026-09-01', 0.1), deposit('2026-09-01', 0.2), withdrawal('2026-09-02', 0.3)];
    expect(getSavingsStreak(rows, '2026-09-10')).toMatchObject({ balance: 0, current: 0, best: 1, totalDeposits: 0.3, totalWithdrawals: 0.3, startedAt: null });
  });
});

describe('opt-in demonstration', () => {
  it('creates isolated deterministic datasets without future movements', () => {
    const first = createDemoData('2026-09-30');
    const second = createDemoData('2026-09-30');
    expect(first).toEqual(second);
    expect(first.registros.every(row => row.id.startsWith('demo-') && row.fecha <= '2026-09-30')).toBe(true);
    expect(getMonthlySummary(first.registros)).toHaveLength(6);
    first.config.moneda = 'USD';
    first.categorias[0].nombre = 'Modificada';
    expect(second.config.moneda).toBe('COP');
    expect(second.categorias[0].nombre).toBe('Sueldo');
  });
});

it('retains prior-month liquidity, extra income and reserved savings', () => {
 const rows = [salary('2026-09-01', 100000), record('2026-09-15', {monto: 20000}), salary('2026-10-01', 50000), deposit('2026-10-02', 30000)];
 expect(getTotals(rows).available).toBe(100000);
 expect(getTotals(rows).income).toBe(150000);
 expect(getTotals(rows, '2026-10-01', '2026-10-31').available).toBe(20000);
});

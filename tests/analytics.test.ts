import { describe, expect, it, vi } from 'vitest';
import type { Config, Deuda, Registro } from '../src/types';
import { DEFAULT_CONFIG } from '../src/lib/defaults';
import { createDemoData } from '../src/lib/demo';
import {
  addDays, addMonths, getAntExpenses, getCategoryTotals, getCycles, getDebtSummary, getHeatmap,
  getMonthlySummary, getRepeatedExpenses, getSpendingPatterns, getStreaks, getTagTotals,
  getTotals, getUnnecessaryGrowth, growthPercent, inferSalaryPeriod, normalizeDescription, todayISO,
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
    expect(getTotals(rows, '2026-09-01', '2026-09-30')).toMatchObject({ income: 1000, expenses: 100, savings: 900, debtPayments: 200, available: 700 });
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
    expect(cycles[1]).toMatchObject({ start: '2026-09-01', end: '2026-09-30', days: 30, elapsedDays: 10, dailyAverage: 10000, projection: 300000, spentPercent: 10 });
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
    expect(getStreaks(rows, cfg(), '2026-09-12')).toMatchObject({ current: 4, best: 7, confirmedDays: ['2026-09-11'], badges: [3, 7] });
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

import type { Registro } from '../types';
import { isSavingsDeposit, isSavingsWithdrawal, todayISO } from './analytics';

export type SavingsMode = 'deposit' | 'withdraw';
export type SavingsChange = { record: Registro } | { deleteId: string };
export const MAX_SAVINGS_AMOUNT = 1_000_000_000_000;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Validates every historical balance, not only the ending balance. This keeps
 * a backdated edit or deleted deposit from unfunding a later withdrawal. */
export function validateSavingsLedger(records: Registro[], today = todayISO()): void {
  const rows = records.filter(row => !row.eliminado && row.fecha <= today
    && (isSavingsDeposit(row) || isSavingsWithdrawal(row)))
    .sort((a, b) => a.fecha.localeCompare(b.fecha)
      || Date.parse(a.creado_en) - Date.parse(b.creado_en)
      || a.id.localeCompare(b.id));
  let cents = 0;
  for (const row of rows) {
    if (!validDate(row.fecha) || !Number.isFinite(row.monto) || row.monto < 0 || row.monto > MAX_SAVINGS_AMOUNT) {
      throw new Error('Hay un movimiento de ahorro con fecha o monto inválido. Revísalo antes de continuar.');
    }
    cents += Math.round(row.monto * 100) * (isSavingsDeposit(row) ? 1 : -1);
    if (!Number.isSafeInteger(cents)) throw new Error('El saldo acumulado supera el límite permitido.');
    if (cents < 0) throw new Error(`El ahorro quedaría sin saldo suficiente el ${row.fecha}. Revisa los depósitos y retiros de esa fecha.`);
  }
}

export function validateSavingsChange(records: Registro[], change: SavingsChange, today = todayISO()): void {
  if ('record' in change) {
    const row = change.record;
    if (isSavingsDeposit(row) || isSavingsWithdrawal(row)) {
      if (!Number.isFinite(row.monto) || row.monto <= 0 || row.monto > MAX_SAVINGS_AMOUNT || Math.round(row.monto * 100) <= 0) {
        throw new Error('Escribe un monto entre 0,01 y 1.000.000.000.000.');
      }
      if (!validDate(row.fecha)) throw new Error('Selecciona una fecha válida.');
      if (row.fecha > today) throw new Error('El ahorro debe corresponder a una fecha de hoy o anterior.');
    }
    validateSavingsLedger([...records.filter(existing => existing.id !== row.id), row], today);
  } else {
    validateSavingsLedger(records.filter(row => row.id !== change.deleteId), today);
  }
}

import { getDebtSummary, getTotals } from './analytics';
import { money, today } from './format';
import type { DataSet, Registro } from '../types';

export async function sharePdf(file: File, text: string): Promise<boolean> {
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) return false;
  try { await navigator.share({ files: [file], title: 'Mi resumen Drip', text }); return true; }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return false; throw new Error('No se pudo abrir la hoja para compartir. Puedes descargar el PDF.'); }
}
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a'); link.href = url; link.download = file.name; link.rel = 'noopener';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export const whatsappUrl = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const emailUrl = (text: string): string => `mailto:?subject=${encodeURIComponent('Mi resumen Drip')}&body=${encodeURIComponent(text)}`;

export function summaryText(data: DataSet, start: string, end: string): string {
  const totals = getTotals(data.registros, start, end);
  const debt = getDebtSummary(data.deudas, data.registros, end);
  const amount = (value: number) => money(value, data.config.moneda);
  return `Mi resumen Drip · ${start} al ${end}\nIngresos: ${amount(totals.income)}\nGastos: ${amount(totals.expenses)}\nAhorro neto: ${amount(totals.savings)}\nPagos a deuda: ${amount(totals.debtPayments)}\nSaldo de deuda estimado: ${amount(debt.balance)}`;
}

/** Prevent spreadsheet formula execution, including payloads hidden behind whitespace. */
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function createCsv(data: DataSet): File {
  const fields: Array<keyof Registro> = ['id', 'fecha', 'tipo', 'subtipo', 'monto', 'categoria', 'tags', 'descripcion', 'metodo_pago', 'necesidad', 'recurrente_id', 'deuda_id', 'creado_en', 'actualizado_en', 'eliminado'];
  const lines = [fields.map(csvCell).join(','), ...data.registros.filter(row => !row.eliminado).map(row => fields.map(field => csvCell(row[field])).join(','))];
  return new File(['\uFEFF' + lines.join('\r\n')], `Drip-movimientos-${today()}.csv`, { type: 'text/csv;charset=utf-8' });
}
export function exportCsv(data: DataSet): void { downloadFile(createCsv(data)); }

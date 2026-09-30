import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

export function money(amount: number, currency = 'COP'): string {
  try { return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number.isFinite(amount) ? amount : 0); }
  catch { return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Number.isFinite(amount) ? amount : 0); }
}

/** Financial dates consistently use the backend's America/Bogota calendar. */
export function today(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatDate(value: string, pattern = "d 'de' MMMM"): string {
  if (!value) return '';
  try { return format(parseISO(value), pattern, { locale: es }); } catch { return value; }
}

export function normalizeText(value: string): string {
  return value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\d/g, '').replace(/\s+/g, ' ').trim();
}

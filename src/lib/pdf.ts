import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getAntExpenses, getCategoryTotals, getDebtSummary, getStreaks, getTotals, getUnnecessaryGrowth } from './analytics';
import { formatDate, money } from './format';
import type { DataSet } from '../types';

export interface SummaryRange { start: string; end: string; title?: string }
const INDIGO: [number, number, number] = [79, 70, 229];
const INK: [number, number, number] = [31, 41, 55];
// Standard PDF fonts support Spanish. Normalize currency spacing for consistent measurement.
const printable = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ').replace(/[–—]/g, '-');

/** Creates a local PDF only. No financial data is sent to another service. */
export function generateSummaryPdf(data: DataSet, range: SummaryRange): File {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end) || range.end < range.start) throw new Error('Elige un rango de fechas válido.');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: 'Drip - Resumen de finanzas', subject: `${range.start} a ${range.end}`, creator: 'Drip' });
  const records = data.registros.filter(row => !row.eliminado && row.fecha >= range.start && row.fecha <= range.end);
  const totals = getTotals(records);
  const debt = getDebtSummary(data.deudas, data.registros, range.end);
  const ants = getAntExpenses(data.registros, data.config, range.end);
  const streak = getStreaks(data.registros, data.config, range.end);
  const growth = getUnnecessaryGrowth(data.registros, range.start, range.end);
  const categories = getCategoryTotals(records);
  const amount = (value: number) => printable(money(value, data.config.moneda));
  let y = 20;

  const ensure = (height: number) => { if (y + height > 278) { doc.addPage(); y = 20; } };
  const heading = (title: string) => {
    ensure(18); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK);
    doc.text(title, 16, y); y += 7;
  };
  const paragraph = (text: string) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(75, 85, 99);
    const lines = doc.splitTextToSize(printable(text), 178) as string[];
    ensure(lines.length * 5 + 6); doc.text(lines, 16, y); y += lines.length * 5 + 6;
  };
  const table = (head: string[], body: string[][], widths?: Record<number, { cellWidth: number }>) => {
    ensure(22);
    autoTable(doc, {
      startY: y, head: [head], body, theme: 'striped',
      margin: { left: 16, right: 16, top: 20, bottom: 20 },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, overflow: 'linebreak', textColor: INK },
      headStyles: { fillColor: INDIGO, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 248, 250] },
      columnStyles: widths, rowPageBreak: 'avoid',
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  };

  doc.setFillColor(...INDIGO); doc.roundedRect(16, 15, 14, 14, 4, 4, 'F');
  doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.text('d', 20.8, 24.6);
  doc.setTextColor(...INK); doc.setFontSize(24); doc.text('Drip', 35, 25);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(107, 114, 128);
  doc.text('Daily Records for Individuals & Partners', 35, 31);
  y = 43;
  heading(range.title || 'Tu resumen financiero');
  paragraph(`${formatDate(range.start, 'd MMM yyyy')} al ${formatDate(range.end, 'd MMM yyyy')} | ${data.config.moneda}`);

  const cards: Array<[string, number]> = [['Ingresos', totals.income], ['Gastos', totals.expenses], ['Ahorro neto', totals.savings], ['Saldo de deuda al cierre', debt.balance]];
  cards.forEach(([label, value], index) => {
    const x = 16 + (index % 2) * 92;
    const top = y + Math.floor(index / 2) * 29;
    doc.setFillColor(247, 248, 250); doc.roundedRect(x, top, 86, 24, 3, 3, 'F');
    doc.setFontSize(9); doc.setTextColor(107, 114, 128); doc.setFont('helvetica', 'normal'); doc.text(label, x + 5, top + 7);
    doc.setFontSize(15); doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.text(amount(value), x + 5, top + 17);
  });
  y += 66;
  paragraph(`Pagos a deudas: ${amount(totals.debtPayments)}. Disponible después de gastos y pagos: ${amount(totals.available)}. La deuda incluye intereses estimados, no una liquidación del acreedor.`);

  heading('En qué se fue el dinero');
  if (categories.length) {
    const max = Math.max(...categories.map(category => category.total), 1);
    categories.slice(0, 8).forEach(category => {
      ensure(14); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK);
      doc.text(printable(category.name).slice(0, 45), 16, y); doc.text(amount(category.total), 194, y, { align: 'right' });
      doc.setFillColor(235, 236, 244); doc.roundedRect(16, y + 2, 178, 2.5, 1, 1, 'F');
      doc.setFillColor(...INDIGO); doc.roundedRect(16, y + 2, Math.max(1, category.total / max * 178), 2.5, 1, 1, 'F'); y += 12;
    });
    y += 3;
    table(['Categoría', 'Movimientos', 'Total', '% del gasto'], categories.map(category => [printable(category.name), String(category.count), amount(category.total), `${totals.expenses ? (category.total / totals.expenses * 100).toFixed(1) : 0}%`]));
  } else paragraph('No registraste gastos en este periodo.');

  heading('Pequeños gastos, gran impacto');
  paragraph(`Gastos hormiga en los 30 días hasta el cierre: ${amount(ants.total)}. Proyección anual al mismo ritmo: ${amount(ants.annualProjection)}.`);
  if (ants.items.length) table(['Descripción o categoría', 'Veces', 'Total'], ants.items.slice(0, 10).map(item => [printable(item.label), String(item.count), amount(item.total)]));
  else paragraph('Aún no hay patrones de gastos hormiga con los umbrales actuales.');

  heading('Gastos innecesarios y hábitos');
  paragraph(`Innecesarios en el periodo: ${amount(growth.current)}. Periodo anterior equivalente: ${amount(growth.previous)}. Variación: ${growth.percent === null ? 'sin base de comparación' : `${growth.percent > 0 ? '+' : ''}${growth.percent.toFixed(1)}%`}.`);
  paragraph(`Racha al cierre: ${streak.current} días sin gastar. Mejor racha: ${streak.best} días. Semanas consecutivas reduciendo gastos: ${streak.weekly}. Reducción acumulada: ${streak.weeklyReductionPercent.toFixed(1)}%.`);
  paragraph(`Saldo de deuda estimado: ${amount(debt.balance)}. Intereses estimados acumulados: ${amount(debt.interest)}. ${debt.payoffDate ? `Fecha estimada de liberación: ${formatDate(debt.payoffDate, 'd MMM yyyy')}.` : 'Sin fecha de liberación estimable con las cuotas actuales.'}`);

  heading('Detalle de movimientos');
  if (records.length) {
    const names: Record<string, string> = { ingreso: 'Ingreso', gasto: 'Gasto', deuda_aumento: 'Más deuda', deuda_pago: 'Pago deuda', sin_gasto: 'Sin gasto' };
    table(['Fecha', 'Tipo', 'Descripción / categoría', 'Monto', 'Método'], [...records].sort((a, b) => a.fecha.localeCompare(b.fecha)).map(row => [formatDate(row.fecha, 'dd/MM/yy'), names[row.tipo], printable(`${row.descripcion || row.categoria || 'Día confirmado'}${row.descripcion && row.categoria ? ` - ${row.categoria}` : ''}${row.tags ? `\n${row.tags}` : ''}`), amount(row.monto), row.metodo_pago]), { 0: { cellWidth: 19 }, 1: { cellWidth: 22 }, 2: { cellWidth: 78 }, 3: { cellWidth: 34 }, 4: { cellWidth: 25 } });
  } else paragraph('No hay movimientos en el rango seleccionado.');

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setDrawColor(230, 232, 237); doc.line(16, 284, 194, 284);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(107, 114, 128);
    doc.text('Drip - Tus finanzas, a tu ritmo. Generado en tu dispositivo.', 16, 290);
    doc.text(`${page} / ${pages}`, 194, 290, { align: 'right' });
  }
  return new File([doc.output('arraybuffer')], `Drip-${range.start}-${range.end}.pdf`, { type: 'application/pdf' });
}

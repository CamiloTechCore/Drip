import type { DataSet, Registro } from '../types';
import { addDays, addMonths, todayISO } from './analytics';
import { DEFAULT_CATEGORIES, DEFAULT_CONFIG } from './defaults';

/** Fictional, deterministic records. The application keeps this data isolated
 * from the device's real cache and never sends these records to Google Sheets. */
export function createDemoData(today = todayISO(), userId = 'demo-user'): DataSet {
  const currentMonth = `${today.slice(0, 7)}-01`;
  const firstMonth = addMonths(currentMonth, -5);
  const records: Registro[] = [];
  let sequence = 0;
  const create = (fecha: string, values: Partial<Registro>) => {
    if (fecha > today) return;
    sequence += 1;
    const timestamp = `${fecha}T17:00:00.000Z`;
    records.push({
      id: `demo-${sequence}`, fecha, tipo: 'gasto', subtipo: 'variable', monto: 0,
      categoria: 'Otros', tags: '', descripcion: '', metodo_pago: 'debito', necesidad: 'necesario',
      recurrente_id: '', deuda_id: '', creado_en: timestamp, actualizado_en: timestamp, eliminado: false, usuario_id: userId,
      ...values,
    });
  };
  for (let month = 0; month < 6; month += 1) {
    const start = addMonths(firstMonth, month);
    create(start, { tipo: 'ingreso', subtipo: 'sueldo', monto: 4200000, categoria: 'Sueldo', descripcion: 'Sueldo mensual', necesidad: '', metodo_pago: 'transferencia' });
    create(addDays(start, 1), { subtipo: 'fijo', monto: 1200000, categoria: 'Vivienda', descripcion: 'Arriendo compartido', tags: 'en pareja,hogar', recurrente_id: 'demo-rent' });
    create(addDays(start, 4), { subtipo: 'fijo', monto: 98000, categoria: 'Servicios', descripcion: 'Internet hogar', tags: 'hogar', recurrente_id: 'demo-internet' });
    create(addDays(start, 8), { tipo: 'ingreso', subtipo: 'adicional', monto: 350000 + (month % 3) * 95000, categoria: 'Ingreso extra', descripcion: 'Proyecto independiente', tags: 'personal', necesidad: '', metodo_pago: 'transferencia' });
    create(addDays(start, 14), { tipo: 'deuda_pago', subtipo: '', monto: 220000, categoria: 'Deudas', descripcion: 'Cuota del crédito', tags: 'personal', necesidad: '', deuda_id: 'demo-debt', metodo_pago: 'transferencia' });
    create(addDays(start, 17), { subtipo: 'fijo', monto: 32900, categoria: 'Suscripciones', descripcion: 'Música en pareja', tags: 'en pareja', recurrente_id: 'demo-music', necesidad: 'innecesario' });
    for (let day = 3; day < 28; day += 4) {
      const date = addDays(start, day);
      // Four recent days without variable purchases make the streak visible.
      if (date > addDays(today, -4)) continue;
      create(date, { monto: 6500 + (day % 3) * 1500, categoria: 'Comida fuera', descripcion: 'Café de la tarde', tags: 'antojo,trabajo', metodo_pago: 'efectivo', necesidad: 'innecesario' });
      if (day % 8 === 3) create(date, { monto: 145000 + (month % 2) * 18000, categoria: 'Mercado', descripcion: 'Mercado semanal', tags: 'en pareja,hogar' });
      if (day % 8 === 7) create(date, { monto: 32000 + (month % 2) * 6000, categoria: 'Transporte', descripcion: 'Recargas de transporte', tags: 'trabajo,personal' });
    }
    const outing = addDays(start, 21);
    if (outing <= addDays(today, -4)) create(outing, { monto: 190000 - month * 14000, categoria: 'Ocio', descripcion: 'Cena y cine', tags: 'en pareja,antojo', necesidad: 'innecesario' });
    const shopping = addDays(start, 12);
    if (shopping <= addDays(today, -4)) create(shopping, { monto: 160000 - month * 17000, categoria: 'Ropa', descripcion: 'Compra del mes', tags: 'personal', necesidad: 'innecesario' });
  }
  create(addDays(today, -1), { tipo: 'sin_gasto', subtipo: '', monto: 0, categoria: 'Otros', descripcion: 'Día sin compras', necesidad: '', metodo_pago: 'otro' });
  create(today, { tipo: 'sin_gasto', subtipo: '', monto: 0, categoria: 'Otros', descripcion: 'Hoy cuidamos el ahorro', tags: 'en pareja', necesidad: '', metodo_pago: 'otro' });
  const nextMonth = addMonths(currentMonth, 1);
  const nextDate = (dayOffset: number): string => {
    const candidate = addDays(currentMonth, dayOffset);
    return candidate >= today ? candidate : addDays(nextMonth, dayOffset);
  };
  return {
    registros: records.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    categorias: DEFAULT_CATEGORIES.map(category => ({ ...category,
      presupuesto_mensual: ({ Vivienda: 1300000, Mercado: 600000, 'Comida fuera': 120000, Transporte: 180000, Ocio: 250000, Ropa: 180000 } as Record<string, number>)[category.nombre] ?? 0,
    })),
    deudas: [{ id: 'demo-debt', nombre: 'Crédito personal', acreedor: 'Banco de ejemplo', monto_inicial: 3600000, tasa_interes_mensual: 1.5,
      fecha_inicio: firstMonth, cuota_minima: 220000, dia_pago: 15, activa: true }],
    recurrentes: [
      { id: 'demo-rent', descripcion: 'Arriendo compartido', monto: 1200000, categoria: 'Vivienda', tags: 'en pareja,hogar', frecuencia: 'mensual', dia: 2, proximo_pago: nextDate(1), metodo_pago: 'transferencia', activa: true },
      { id: 'demo-internet', descripcion: 'Internet hogar', monto: 98000, categoria: 'Servicios', tags: 'hogar', frecuencia: 'mensual', dia: 5, proximo_pago: nextDate(4), metodo_pago: 'debito', activa: true },
      { id: 'demo-music', descripcion: 'Música en pareja', monto: 32900, categoria: 'Suscripciones', tags: 'en pareja', frecuencia: 'mensual', dia: 18, proximo_pago: nextDate(17), metodo_pago: 'debito', activa: true },
    ],
    config: { ...DEFAULT_CONFIG },
  };
}

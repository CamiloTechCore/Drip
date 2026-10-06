import type { Categoria, Config, DataSet, Deuda, Entity, EntityName, Recurrente, Registro } from '../types';

const MAX_AMOUNT = 1_000_000_000_000;
const methods = ['efectivo', 'debito', 'credito', 'transferencia', 'otro'];
function text(value: string, field: string, max: number, required = false): string {
  if (typeof value !== 'string') throw new Error(`${field} debe ser texto.`);
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (clean.length > max || (required && !clean)) throw new Error(`${field} es obligatorio y admite hasta ${max} caracteres.`);
  return clean;
}
function id(value: string, max = 200): string {
  const clean = text(value, 'El identificador', max, true);
  if (!/^[a-zA-Z0-9_.:\-]+$/.test(clean)) throw new Error('El identificador no es válido.');
  return clean;
}
function number(value: number, field: string, min = 0, max = MAX_AMOUNT, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${field} debe ser ${integer ? 'un entero' : 'un número'} entre ${min} y ${max}.`);
  return value;
}
function enumeration<T extends string>(value: T, values: readonly string[], field: string): T {
  if (!values.includes(value)) throw new Error(`Selecciona un valor válido para ${field}.`);
  return value;
}
function bool(value: boolean, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} debe estar activado o desactivado.`);
  return value;
}
export function validDate(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2200-12-31' || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Elige una fecha real entre 1900 y 2200.');
  return value;
}
function validIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('La fecha de creación del movimiento no es válida.');
  validDate(value.slice(0, 10)); return value;
}
export function validateEmail(value: string): string {
  const clean = text(value, 'El correo', 180, true).toLocaleLowerCase('es');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Ingresa un correo válido.');
  return clean;
}
/** Mirrors the backend rule: more than 8 alphanumeric characters plus one special character. */
export function validatePassword(value: string): string {
  if (typeof value !== 'string' || !/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{9,200}$/.test(value)) throw new Error('La contraseña debe tener más de 8 caracteres alfanuméricos e incluir un carácter especial.');
  return value;
}
/** Existing credentials must be checked by the server, without applying a newer signup policy or trimming them. */
export function validateLoginPassword(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) throw new Error('Ingresa tu contraseña; admite hasta 200 caracteres.');
  return value;
}
export function validateName(value: string): string {
  return text(value, 'El nombre', 120, true);
}
function tags(value: string): string {
  return [...new Set(text(value, 'Los tags', 500).toLocaleLowerCase('es').split(',').map(tag => tag.replace(/#/g, '').trim()).filter(Boolean))].slice(0, 20).join(',');
}

/** Validate before IndexedDB so a malformed offline entry cannot block the atomic server batch. */
export function validateRegistro(value: Registro, data: DataSet): Registro {
  const row: Registro = { ...value, id: id(value.id), fecha: validDate(value.fecha),
    tipo: enumeration(value.tipo, ['ingreso', 'gasto', 'deuda_aumento', 'deuda_pago', 'sin_gasto'], 'el tipo'),
    monto: number(value.monto, 'El monto'), categoria: text(value.categoria, 'La categoría', 80),
    descripcion: text(value.descripcion, 'La descripción', 500), tags: tags(value.tags),
    metodo_pago: enumeration(value.metodo_pago, methods, 'el método de pago'),
    recurrente_id: value.recurrente_id ? id(value.recurrente_id) : '', deuda_id: value.deuda_id ? id(value.deuda_id) : '',
    creado_en: value.creado_en ? validIso(value.creado_en) : '',
  };
  if (row.tipo === 'ingreso') enumeration(row.subtipo, ['sueldo', 'adicional'], 'el subtipo');
  else if (row.tipo === 'gasto') {
    enumeration(row.subtipo, ['variable', 'fijo'], 'el subtipo');
    enumeration(row.necesidad, ['necesario', 'innecesario'], 'la necesidad');
  } else if (row.subtipo !== '') throw new Error('Los registros de deuda y sin gasto no tienen subtipo.');
  if (row.tipo !== 'gasto' && row.necesidad !== '') throw new Error('La necesidad solo aplica a gastos.');
  if (row.tipo === 'sin_gasto') {
    if (row.monto !== 0) throw new Error('Un día sin gastar debe tener monto cero.');
    if (!row.categoria) row.categoria = data.categorias.find(category => category.nombre === 'Otros')?.nombre ?? data.categorias[0]?.nombre ?? '';
  }
  let category = data.categorias.find(item => item.nombre === row.categoria);
  if (!category) {
    // Assign default category if the specified category doesn't exist (e.g., during sync with stale data)
    const defaultCategory = data.categorias.find(cat => cat.nombre === 'Otros') ?? data.categorias[0];
    if (defaultCategory) {
      row.categoria = defaultCategory.nombre;
      category = defaultCategory;
    } else {
      throw new Error('No hay categorías disponibles. Configura al menos una categoría.');
    }
  }
  if ((row.tipo === 'ingreso' || row.tipo === 'gasto') && category.tipo !== row.tipo) throw new Error('La categoría no corresponde al tipo de movimiento.');
  if (row.tipo === 'deuda_aumento' || row.tipo === 'deuda_pago') {
    if (!data.deudas.some(debt => debt.id === row.deuda_id && (!debt.usuario_id || debt.usuario_id === row.usuario_id))) throw new Error('Selecciona una deuda existente.');
  } else if (row.deuda_id) throw new Error('Solo un movimiento de deuda puede enlazar una deuda.');
  if (row.recurrente_id && (row.tipo !== 'gasto' || row.subtipo !== 'fijo' || !data.recurrentes.some(template => template.id === row.recurrente_id && (!template.usuario_id || template.usuario_id === row.usuario_id)))) throw new Error('La plantilla debe existir y el movimiento debe ser un gasto fijo.');
  return row;
}

export function validateEntity(entity: EntityName, value: Entity, data: DataSet): Entity {
  const base = { id: id(value.id, entity === 'recurrente' ? 180 : 200), activa: bool(value.activa, 'El estado') };
  if (entity === 'categoria') {
    const category = value as Categoria;
    const next: Categoria = { ...base, nombre: text(category.nombre, 'El nombre', 80, true), tipo: enumeration(category.tipo, ['ingreso', 'gasto'], 'el tipo'), color: text(category.color, 'El color', 7, true), icono: text(category.icono, 'El icono', 40, true), presupuesto_mensual: 0 };
    if (!/^#[0-9a-f]{6}$/i.test(next.color)) throw new Error('El color debe tener seis dígitos hexadecimales.');
    if (data.categorias.some(item => item.id !== next.id && item.nombre.toLocaleLowerCase('es') === next.nombre.toLocaleLowerCase('es'))) throw new Error('Ya existe una categoría con ese nombre.');
    const previous = data.categorias.find(item => item.id === next.id);
    if (previous && previous.tipo !== next.tipo && (data.registros.some(row => row.categoria === previous.nombre) || data.recurrentes.some(row => row.categoria === previous.nombre))) throw new Error('No puedes cambiar el tipo de una categoría utilizada. Crea otra categoría.');
    return next;
  }
  if (entity === 'deuda') {
    const debt = value as Deuda;
    return { ...base, usuario_id: debt.usuario_id, nombre: text(debt.nombre, 'El nombre', 100, true), acreedor: text(debt.acreedor, 'El acreedor', 150), monto_inicial: number(debt.monto_inicial, 'El saldo inicial'), tasa_interes_mensual: number(debt.tasa_interes_mensual, 'La tasa mensual', 0, 100), fecha_inicio: validDate(debt.fecha_inicio), cuota_minima: number(debt.cuota_minima, 'La cuota'), dia_pago: number(debt.dia_pago, 'El día de pago', 1, 31, true) };
  }
  const template = value as Recurrente;
  let category = text(template.categoria, 'La categoría', 80, true);
  if (!data.categorias.some(item => item.nombre === category && item.tipo === 'gasto')) {
    // Assign default category if the specified category doesn't exist (e.g., during sync with stale data)
    const defaultCategory = data.categorias.find(cat => cat.nombre === 'Otros' && cat.tipo === 'gasto') ?? data.categorias.find(cat => cat.tipo === 'gasto');
    if (defaultCategory) {
      category = defaultCategory.nombre;
    } else {
      throw new Error('No hay categorías de gasto disponibles. Configura al menos una categoría de gasto.');
    }
  }
  return { ...base, usuario_id: template.usuario_id, descripcion: text(template.descripcion, 'La descripción', 500, true), monto: number(template.monto, 'El monto'), categoria: category, tags: tags(template.tags), frecuencia: enumeration(template.frecuencia, ['semanal', 'quincenal', 'mensual', 'anual'], 'la frecuencia'), dia: number(template.dia, 'El día de pago', 1, 31, true), proximo_pago: validDate(template.proximo_pago), metodo_pago: enumeration(template.metodo_pago, methods, 'el método de pago') };
}

export function validateConfig(config: Config): Config {
  const moneda = text(config.moneda, 'La moneda', 3, true).toUpperCase();
  if (!/^[A-Z]{3}$/.test(moneda)) throw new Error('La moneda debe ser un código de tres letras, por ejemplo COP.');
  return { moneda, umbral_hormiga: number(config.umbral_hormiga, 'El umbral hormiga'), min_repeticiones_hormiga: number(config.min_repeticiones_hormiga, 'Las repeticiones', 1, 1000, true), tipo_ciclo: enumeration(config.tipo_ciclo, ['auto', 'mensual', 'quincenal'], 'el ciclo'), dia_corte: number(config.dia_corte, 'El día de corte', 1, 31, true), excluir_fijos_de_racha: bool(config.excluir_fijos_de_racha, 'Excluir gastos fijos'), meta_reduccion_semanal_pct: number(config.meta_reduccion_semanal_pct, 'La meta semanal', 0, 100) };
}

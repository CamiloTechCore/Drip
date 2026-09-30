import type { Categoria, Config, DataSet } from '../types';

export const DEFAULT_CONFIG: Config = {
  moneda: 'COP', umbral_hormiga: 20000, min_repeticiones_hormiga: 3,
  tipo_ciclo: 'auto', dia_corte: 1, excluir_fijos_de_racha: true,
  meta_reduccion_semanal_pct: 0,
};

const seeds: Array<[string, string, 'ingreso' | 'gasto', string, string]> = [
  ['sueldo', 'Sueldo', 'ingreso', '#10b981', 'Wallet'], ['extra', 'Ingreso extra', 'ingreso', '#34d399', 'Sparkles'],
  ['vivienda', 'Vivienda', 'gasto', '#6366f1', 'House'], ['servicios', 'Servicios', 'gasto', '#818cf8', 'Zap'],
  ['mercado', 'Mercado', 'gasto', '#14b8a6', 'ShoppingBasket'], ['comida', 'Comida fuera', 'gasto', '#f59e0b', 'Utensils'],
  ['transporte', 'Transporte', 'gasto', '#0ea5e9', 'Bus'], ['salud', 'Salud', 'gasto', '#f43f5e', 'HeartPulse'],
  ['educacion', 'Educación', 'gasto', '#8b5cf6', 'GraduationCap'], ['ocio', 'Ocio', 'gasto', '#a855f7', 'Gamepad2'],
  ['suscripciones', 'Suscripciones', 'gasto', '#ec4899', 'Repeat'], ['ropa', 'Ropa', 'gasto', '#d946ef', 'Shirt'],
  ['deudas', 'Deudas', 'gasto', '#ef4444', 'CreditCard'], ['ahorro', 'Ahorro', 'gasto', '#059669', 'PiggyBank'],
  ['otros', 'Otros', 'gasto', '#64748b', 'CircleEllipsis'],
];

export const DEFAULT_CATEGORIES: Categoria[] = seeds.map(([id, nombre, tipo, color, icono]) => ({
  id: `cat-${id}`, nombre, tipo, color, icono, presupuesto_mensual: 0, activa: true,
}));

// Consumers copy these defaults before editing. Demo data is deliberately separate.
export const EMPTY_DATA: DataSet = {
  registros: [], categorias: DEFAULT_CATEGORIES, deudas: [], recurrentes: [], config: DEFAULT_CONFIG,
};

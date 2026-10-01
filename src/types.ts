export type Tipo = 'ingreso' | 'gasto' | 'deuda_aumento' | 'deuda_pago' | 'sin_gasto';
export type Metodo = 'efectivo' | 'debito' | 'credito' | 'transferencia' | 'otro';
export interface Registro {
  id: string; fecha: string; tipo: Tipo; subtipo: 'sueldo' | 'adicional' | 'variable' | 'fijo' | '';
  monto: number; categoria: string; tags: string; descripcion: string; metodo_pago: Metodo;
  necesidad: 'necesario' | 'innecesario' | ''; recurrente_id: string; deuda_id: string;
  creado_en: string; actualizado_en: string; eliminado: boolean; usuario_id?: string;
}
export interface Usuario { id: string; nombre: string; correo: string }
export interface Categoria { id: string; nombre: string; tipo: 'ingreso' | 'gasto'; color: string; icono: string; presupuesto_mensual: number; activa: boolean }
export interface Deuda { id: string; nombre: string; acreedor: string; monto_inicial: number; tasa_interes_mensual: number; fecha_inicio: string; cuota_minima: number; dia_pago: number; activa: boolean }
export interface Recurrente { id: string; descripcion: string; monto: number; categoria: string; tags: string; frecuencia: 'semanal' | 'quincenal' | 'mensual' | 'anual'; dia: number; proximo_pago: string; metodo_pago: Metodo; activa: boolean }
export interface Config { moneda: string; umbral_hormiga: number; min_repeticiones_hormiga: number; tipo_ciclo: 'auto' | 'mensual' | 'quincenal'; dia_corte: number; excluir_fijos_de_racha: boolean; meta_reduccion_semanal_pct: number }
export interface DataSet { registros: Registro[]; categorias: Categoria[]; deudas: Deuda[]; recurrentes: Recurrente[]; config: Config }
export type Entity = Categoria | Deuda | Recurrente;
export type EntityName = 'categoria' | 'deuda' | 'recurrente';

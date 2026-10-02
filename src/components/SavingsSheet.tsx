import { useState, type FormEvent } from 'react';
import { Check, PiggyBank, Trash2 } from 'lucide-react';
import { useDrip } from '../context';
import { getSavingsStreak, todayISO } from '../lib/analytics';
import { money } from '../lib/format';
import { MAX_SAVINGS_AMOUNT, validateSavingsChange, type SavingsMode } from '../lib/savings';
import type { Metodo, Registro } from '../types';
import { Sheet } from './ui';

export default function SavingsSheet({ mode, record, onClose }: {
  mode: SavingsMode; record?: Registro; onClose: () => void;
}) {
  const { data, saveRegistro, deleteRegistro, toast } = useDrip();
  const [amount, setAmount] = useState(record ? String(record.monto) : '');
  const [date, setDate] = useState(record?.fecha ?? todayISO());
  const [method, setMethod] = useState<Metodo>(record?.metodo_pago ?? 'transferencia');
  const [description, setDescription] = useState(record?.descripcion ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const depositing = mode === 'deposit';
  const balance = getSavingsStreak(data.registros).balance;
  const type = depositing ? 'gasto' : 'ingreso';
  const preferred = depositing ? 'Ahorro' : 'Ingreso extra';
  const category = data.categorias.find(item => item.nombre === record?.categoria && item.tipo === type)
    ?? data.categorias.find(item => item.activa && item.tipo === type && item.nombre === preferred)
    ?? data.categorias.find(item => item.activa && item.tipo === type);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const value = Number(amount.trim().replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || value > MAX_SAVINGS_AMOUNT || Math.round(value * 100) <= 0) {
      setError('Escribe un monto entre 0,01 y 1.000.000.000.000.'); return;
    }
    if (!category) {
      setError(`Crea o activa una categoría de ${depositing ? 'gasto' : 'ingreso'} en Más → Categorías.`); return;
    }
    setBusy(true);
    try {
      const timestamp = new Date().toISOString();
      const existingTags = (record?.tags ?? '').split(',').map(tag => tag.trim().toLowerCase())
        .filter(tag => tag && tag !== 'ahorro_deposito' && tag !== 'ahorro_retiro');
      const row: Registro = {
        id: crypto.randomUUID(), fecha: date, tipo: type, subtipo: depositing ? 'variable' : 'adicional',
        monto: value, categoria: category.nombre, tags: '', descripcion: '', metodo_pago: method,
        necesidad: depositing ? 'necesario' : '', recurrente_id: '', deuda_id: '',
        creado_en: timestamp, actualizado_en: timestamp, eliminado: false,
        ...record,
      };
      Object.assign(row, {
        fecha: date, monto: Math.round(value * 100) / 100, categoria: category.nombre,
        tags: [...new Set([...existingTags, depositing ? 'ahorro_deposito' : 'ahorro_retiro'])].join(','),
        descripcion: description.trim() || (depositing ? 'Depósito a ahorro' : 'Retiro de ahorro'),
        metodo_pago: method, actualizado_en: timestamp, eliminado: false,
      });
      validateSavingsChange(data.registros, { record: row });
      await saveRegistro(row);
      toast(record ? 'Movimiento de ahorro actualizado' : depositing ? 'Depósito de ahorro registrado' : 'Retiro de ahorro registrado');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el movimiento de ahorro.');
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!record || busy) return;
    setError(''); setBusy(true);
    try {
      validateSavingsChange(data.registros, { deleteId: record.id });
      await deleteRegistro(record.id);
      toast('Movimiento de ahorro eliminado');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo eliminar el movimiento de ahorro.');
    } finally { setBusy(false); }
  }

  return (
    <Sheet title={`${record ? 'Editar' : depositing ? 'Depositar en' : 'Retirar del'} ahorro`} onClose={() => { if (!busy) onClose(); }}>
      <form className="capture-form savings-form" onSubmit={submit}>
        <p className="note"><PiggyBank size={17} aria-hidden="true" /> Saldo ahorrado: <strong>{money(balance, data.config.moneda)}</strong></p>
        <label className="amount-label" htmlFor="savings-amount">{depositing ? '¿Cuánto quieres ahorrar?' : '¿Cuánto necesitas retirar?'}</label>
        <div className="amount-input">
          <span aria-hidden="true">$</span>
          <input id="savings-amount" data-autofocus inputMode="decimal" autoComplete="off" placeholder="0" value={amount} onChange={event => setAmount(event.target.value)} required aria-describedby={error ? 'savings-error' : undefined} />
          <span>{data.config.moneda}</span>
        </div>
        <div className="form-two">
          <label>Fecha<input type="date" value={date} max={todayISO()} required onChange={event => setDate(event.target.value)} /></label>
          <label>Método<select value={method} onChange={event => setMethod(event.target.value as Metodo)}>
            <option value="transferencia">Transferencia</option><option value="debito">Débito</option>
            <option value="efectivo">Efectivo</option><option value="credito">Crédito</option><option value="otro">Otro</option>
          </select></label>
        </div>
        <label>Nota opcional<input value={description} maxLength={500} onChange={event => setDescription(event.target.value)} placeholder={depositing ? 'Un paso hacia mi meta' : '¿Para qué usarás tu ahorro?'} /></label>
        <p className="footnote">{depositing ? 'Un depósito adicional conserva tu racha actual.' : 'Cualquier retiro reinicia la racha, aunque dejes una parte del ahorro.'} Verificamos que haya saldo suficiente en cada fecha del historial.</p>
        {error && <p id="savings-error" className="error-message" role="alert">{error}</p>}
        <button className="button primary full" disabled={busy}><Check size={18} />{busy ? 'Guardando…' : record ? 'Guardar cambios' : depositing ? 'Registrar depósito' : 'Registrar retiro'}</button>
        {record && (confirmDelete
          ? <div className="delete-confirm"><p>¿Eliminar este movimiento de ahorro?</p><button type="button" className="button danger" disabled={busy} onClick={remove}>Sí, eliminar</button><button type="button" className="text-button" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancelar</button></div>
          : <button type="button" className="text-button danger-text" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={16} />Eliminar movimiento</button>)}
      </form>
    </Sheet>
  );
}

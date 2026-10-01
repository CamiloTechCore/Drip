import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSet, Registro, Recurrente } from '../src/types';

type Cell = string | number | boolean | Date;
type Envelope<T = unknown> = { ok: boolean; data: T; error?: string; service?: string };

class Sheet {
  values: Cell[][] = [];
  maxRows = 1000;
  constructor(readonly locked: () => boolean) {}
  getLastRow() { return this.values.length; }
  getLastColumn() { return (this.values[0] || []).length; }
  getMaxRows() { return this.maxRows; }
  setFrozenRows() { return this; }
  setColumnWidths() { return this; }
  insertRowsAfter(_row: number, count: number) { this.maxRows += count; }
  getDataRange() { return this.getRange(1, 1, this.values.length || 1, Math.max(1, ...this.values.map(row => row.length))); }
  getRange(row: number | string, col = 1, rowCount = 1, colCount = 1) {
    const start = typeof row === 'number' ? row : 2;
    const range = {
      getValues: () => Array.from({ length: rowCount }, (_, r) => Array.from({ length: colCount }, (_, c) => this.values[start - 1 + r]?.[col - 1 + c] ?? '')),
      setValues: (data: Cell[][]) => {
        if (!this.locked()) throw new Error('Attempted write without a script lock');
        data.forEach((line, r) => {
          const index = start - 1 + r;
          this.values[index] ??= [];
          line.forEach((value, c) => { this.values[index][col - 1 + c] = value; });
        });
        return range;
      },
      setBackground: () => range, setFontColor: () => range, setFontWeight: () => range,
      setNumberFormat: () => range, setDataValidation: () => range,
    };
    return range;
  }
}

function harness() {
  let held = false;
  let acquired = 0;
  let rangeValidations = 0;
  const sheets = new Map<string, Sheet>();
  const properties = new Map<string, string>();
  const token = 'test-placeholder-'.repeat(3);
  const rule = { requireValueInList: () => rule, requireValueInRange: () => { rangeValidations++; return rule; }, setAllowInvalid: () => rule, requireCheckbox: () => rule, build: () => ({}) };
  const source = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8')
    // Substitute declarations only in memory; configured user constants remain
    // untouched on disk, and guards still exercise the production behavior.
    .replace(/^const SPREADSHEET_ID = '[^']*';/m, "const SPREADSHEET_ID = 'test-sheet-id';")
    .replace(/^const API_TOKEN = '[^']*';/m, `const API_TOKEN = ${JSON.stringify(token)};`);
  const output = (value: string) => ({ value, setMimeType() { return this; } });
  const context = createContext({
    Date, Math, JSON,
    LockService: { getScriptLock: () => ({ waitLock: () => { if (held) throw new Error('Nested lock'); held = true; acquired++; }, releaseLock: () => { held = false; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties.get(key), setProperty: (key: string, value: string) => { expect(held).toBe(true); properties.set(key, value); } }) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: output },
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: (name: string) => sheets.get(name), insertSheet: (name: string) => { expect(held).toBe(true); const sheet = new Sheet(() => held); sheets.set(name, sheet); return sheet; } }),
      newDataValidation: () => rule, flush: () => {},
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (date: Date, timezone: string, pattern: string) => pattern === 'yyyy-MM-dd'
        ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
        : date.toISOString(),
      computeDigest: (_algorithm: unknown, value: string) => Array.from(createHash('sha256').update(value, 'utf8').digest()),
      base64Encode: (bytes: number[]) => Buffer.from(bytes).toString('base64'),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
    },
  });
  runInContext(source, context);
  return {
    sheets,
    post<T>(request: object, suppliedToken = token): Envelope<T> {
      context.request_ = { postData: { contents: JSON.stringify({ token: suppliedToken, ...request }) } };
      const result = runInContext('doPost(request_)', context) as { value: string };
      expect(held).toBe(false);
      return JSON.parse(result.value) as Envelope<T>;
    },
    health: () => JSON.parse((runInContext('doGet({})', context) as { value: string }).value) as Envelope,
    setup: () => runInContext('setup()', context),
    get lockCount() { return acquired; },
    get categoryDropdownCount() { return rangeValidations; },
  };
}

const expense = (overrides: Partial<Registro> = {}) => ({
  id: 'expense-1', fecha: '2026-09-29', tipo: 'gasto', subtipo: 'variable', monto: 6500,
  categoria: 'Comida fuera', tags: 'café', descripcion: 'Café', metodo_pago: 'efectivo', necesidad: 'innecesario',
  recurrente_id: '', deuda_id: '', creado_en: '', actualizado_en: '2026-09-30T15:00:00.000Z', eliminado: false,
  ...overrides,
});

describe('single-file Apps Script API', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T20:00:00.000Z')); });
  afterEach(() => vi.useRealTimers());

  it('keeps health public and rejects bad tokens before opening or writing the sheet', () => {
    const api = harness();
    expect(api.health()).toEqual({ ok: true, service: 'finanzas', version: 'Drip_API:V:0.0.0.02' });
    expect(api.post({ action: 'list' }, 'invalid').error).toBe('UNAUTHORIZED');
    expect(api.sheets.size).toBe(0);
    expect(api.lockCount).toBe(0);
  });

  it('creates exactly the specified sheets and preserves records on repeated setup', () => {
    const api = harness();
    api.setup();
    expect([...api.sheets.keys()]).toEqual(['Registros', 'Categorias', 'Deudas', 'Recurrentes', 'Config', 'Usuarios']);
    expect(api.post({ action: 'upsert', registro: expense() }).ok).toBe(true);
    api.setup();
    const listed = api.post<DataSet>({ action: 'list' });
    expect(listed.data.registros).toHaveLength(1);
    expect(listed.data.categorias).toHaveLength(15);
    expect(listed.data.config.moneda).toBe('COP');
  });

  it('installs category dropdowns on both record and recurring sheets during first-request setup', () => {
    const api = harness();
    expect(api.post({ action: 'list' }).ok).toBe(true);
    expect(api.categoryDropdownCount).toBe(2);
  });

  it('handles retried UUIDs, last-write-wins, and incremental tombstones', () => {
    const api = harness();
    const original = api.post<Registro>({ action: 'upsert', registro: expense() }).data;
    const retry = api.post<Registro>({ action: 'upsert', registro: expense({ monto: 9000 }) }).data;
    expect(retry).toEqual(original);
    const listed = api.post<DataSet & { serverTime: string }>({ action: 'list' }).data;
    const timestamp = new Date(Date.now() + 1000).toISOString();
    const deletion = api.post<Registro>({ action: 'delete', id: original.id, actualizado_en: timestamp });
    expect(deletion.data.eliminado).toBe(true);
    expect(api.post<DataSet>({ action: 'list', since: listed.serverTime }).data.registros).toHaveLength(1);
    expect(api.post<Registro>({ action: 'upsert', registro: expense() }).data.eliminado).toBe(true);
    expect(api.post<DataSet>({ action: 'list' }).data.registros).toHaveLength(1);
  });

  it('delivers offline-created old-date records after a recent incremental cursor', () => {
    const api = harness();
    const cursor = api.post<DataSet & { serverTime: string }>({ action: 'list' }).data.serverTime;
    api.post({ action: 'upsert', registro: expense({ fecha: '2026-01-01', actualizado_en: '2026-01-01T10:00:00.000Z' }) });
    const delta = api.post<DataSet>({ action: 'list', since: cursor }).data;
    expect(delta.registros).toHaveLength(1);
    expect(delta.registros[0].fecha).toBe('2026-01-01');
  });

  it('validates the complete batch before persisting any record', () => {
    const api = harness();
    const result = api.post({ action: 'batch', operations: [
      { action: 'upsert', registro: expense() },
      { action: 'upsert', registro: expense({ id: 'bad', fecha: '2026-02-30' }) },
    ] });
    expect(result.error).toBe('VALIDATION_ERROR');
    expect(api.post<DataSet>({ action: 'list' }).data.registros).toHaveLength(0);
  });

  it('applies ordered operations for one ID in a batch without server-clock interference', () => {
    const api = harness();
    const result = api.post<{ registros: Registro[] }>({ action: 'batch', operations: [
      { action: 'upsert', registro: expense() },
      { action: 'upsert', registro: expense({ monto: 8000, actualizado_en: '2026-09-30T15:00:01.000Z' }) },
      { action: 'delete', id: 'expense-1', actualizado_en: '2026-09-30T15:00:02.000Z' },
    ] });
    expect(result.ok).toBe(true);
    expect(result.data.registros).toHaveLength(1);
    expect(result.data.registros[0]).toMatchObject({ monto: 8000, eliminado: true });
    expect(api.post<DataSet>({ action: 'list' }).data.registros).toHaveLength(1);
  });

  it('keeps the latest client version when a batch arrives out of order', () => {
    const api = harness();
    const result = api.post<{ registros: Registro[] }>({ action: 'batch', operations: [
      { action: 'upsert', registro: expense({ monto: 8000, actualizado_en: '2026-09-30T15:00:02.000Z' }) },
      { action: 'upsert', registro: expense({ monto: 1000, actualizado_en: '2026-09-30T15:00:01.000Z' }) },
    ] });
    expect(result.data.registros[0].monto).toBe(8000);
  });

  it('makes a slightly advanced client clock idempotent and rejects excessive clock skew', () => {
    const api = harness();
    const edit = expense({ actualizado_en: '2026-09-30T20:01:00.000Z' });
    const first = api.post<Registro>({ action: 'upsert', registro: edit }).data;
    const retry = api.post<Registro>({ action: 'upsert', registro: edit }).data;
    expect(retry.actualizado_en).toBe(first.actualizado_en);
    expect(api.post({ action: 'upsert', registro: expense({ id: 'future', actualizado_en: '2026-09-30T20:06:00.000Z' }) }).error).toBe('CLOCK_SKEW');
  });

  it.each([
    { monto: -1 }, { monto: '123' }, { fecha: '2026-13-01' }, { categoria: 'Missing' },
    { metodo_pago: 'wire' }, { tipo: 'ingreso', subtipo: 'sueldo', necesidad: '', categoria: 'Comida fuera' },
    { tipo: 'deuda_pago', subtipo: '', necesidad: '', deuda_id: 'missing' },
    { tipo: 'sin_gasto', subtipo: '', necesidad: '', monto: 1 },
  ])('rejects invalid server inputs: %j', invalid => {
    const api = harness();
    expect(api.post({ action: 'upsert', registro: { ...expense(), ...invalid } }).error).toBe('VALIDATION_ERROR');
  });

  it('neutralizes formula text and normalizes tags without changing displayed content', () => {
    const api = harness();
    const text = '=IMPORTXML("https://invalid.test")';
    api.post({ action: 'upsert', registro: expense({ descripcion: text, tags: '#CAFÉ, café, Trabajo' }) });
    expect(api.sheets.get('Registros')?.values[1][7]).toBe("'" + text);
    const record = api.post<DataSet>({ action: 'list' }).data.registros[0];
    expect(record.descripcion).toBe(text);
    expect(record.tags).toBe('café,trabajo');
  });

  it('cascades category renames to historical records and recurrent templates', () => {
    const api = harness();
    api.post({ action: 'upsert', registro: expense() });
    const data = api.post<DataSet>({ action: 'list' }).data;
    const category = data.categorias.find(c => c.nombre === 'Comida fuera');
    expect(api.post({ action: 'saveEntity', entity: 'categoria', data: { ...category, nombre: 'Restaurantes' } }).ok).toBe(true);
    expect(api.post<DataSet>({ action: 'list' }).data.registros[0].categoria).toBe('Restaurantes');
    expect(api.post({ action: 'saveEntity', entity: 'categoria', data: { ...category, nombre: 'Restaurantes', tipo: 'ingreso' } }).error).toBe('ENTITY_IN_USE');
  });

  it('catches up monthly templates, retains day 31, and never recreates deleted occurrences', () => {
    const api = harness();
    const template: Recurrente = { id: 'internet', descripcion: 'Internet', monto: 80000, categoria: 'Servicios', tags: 'hogar', frecuencia: 'mensual', dia: 31, proximo_pago: '2026-08-31', metodo_pago: 'transferencia', activa: true };
    expect(api.post({ action: 'saveEntity', entity: 'recurrente', data: template }).ok).toBe(true);
    const first = api.post<{ registros: Registro[]; recurrentes: Recurrente[]; pending: boolean }>({ action: 'materializeRecurrentes' });
    expect(first.ok).toBe(true);
    expect(first.data.registros.map(r => r.fecha)).toEqual(['2026-08-31', '2026-09-30']);
    expect(first.data.recurrentes[0].proximo_pago).toBe('2026-10-31');
    expect(first.data.pending).toBe(false);
    api.post({ action: 'delete', id: first.data.registros[0].id, actualizado_en: '2026-09-30T20:00:01.000Z' });
    api.post({ action: 'saveEntity', entity: 'recurrente', data: template });
    expect(api.post<{ registros: Registro[] }>({ action: 'materializeRecurrentes' }).data.registros).toHaveLength(0);
    expect(api.post<DataSet>({ action: 'list' }).data.registros).toHaveLength(2);
  });

  it('rejects a broken schema and releases the lock without destroying existing rows', () => {
    const api = harness();
    api.post({ action: 'upsert', registro: expense() });
    const sheet = api.sheets.get('Registros')!;
    sheet.values[0][1] = 'renamed';
    expect(api.post({ action: 'list' }).error).toBe('SCHEMA_MISMATCH');
    expect(sheet.values).toHaveLength(2);
  });

  it('validates configuration and keeps settings with native JSON types', () => {
    const api = harness();
    expect(api.post({ action: 'saveConfig', config: { dia_corte: 32 } }).error).toBe('VALIDATION_ERROR');
    const valid = api.post<DataSet['config']>({ action: 'saveConfig', config: { excluir_fijos_de_racha: false, umbral_hormiga: 12000 } });
    expect(valid.data.excluir_fijos_de_racha).toBe(false);
    expect(valid.data.umbral_hormiga).toBe(12000);
    expect(valid.data.moneda).toBe('COP');
  });

  it('registers a user with a hashed password and rejects duplicate emails', () => {
    const api = harness();
    const created = api.post<{ id: string; nombre: string; correo: string }>({ action: 'register', nombre: 'Ana', correo: 'Ana@Example.com', password: 'Clave123!' });
    expect(created.ok).toBe(true);
    expect(created.data).toEqual({ id: created.data.id, nombre: 'Ana', correo: 'ana@example.com' });
    const row = api.sheets.get('Usuarios')!.values[1];
    expect(row[2]).toBe('ana@example.com');
    expect(row[3]).not.toContain('Clave123!');
    expect(api.post({ action: 'register', nombre: 'Otra', correo: 'ana@example.com', password: 'Clave123!' }).error).toBe('DUPLICATE_USER');
  });

  it('rejects registration passwords without the required strength', () => {
    const api = harness();
    expect(api.post({ action: 'register', nombre: 'Ana', correo: 'ana@example.com', password: 'short1!' }).error).toBe('VALIDATION_ERROR');
    expect(api.post({ action: 'register', nombre: 'Ana', correo: 'ana@example.com', password: 'soloalfanumerico123' }).error).toBe('VALIDATION_ERROR');
  });

  it('logs in with correct credentials and rejects wrong passwords with a generic error', () => {
    const api = harness();
    api.post({ action: 'register', nombre: 'Ana', correo: 'ana@example.com', password: 'Clave123!' });
    const login = api.post<{ id: string; nombre: string; correo: string }>({ action: 'login', correo: 'ANA@example.com', password: 'Clave123!' });
    expect(login.ok).toBe(true);
    expect(login.data.correo).toBe('ana@example.com');
    expect(api.post({ action: 'login', correo: 'ana@example.com', password: 'wrong-pass1!' }).error).toBe('UNAUTHORIZED');
    expect(api.post({ action: 'login', correo: 'missing@example.com', password: 'Clave123!' }).error).toBe('UNAUTHORIZED');
  });

  it('tags new records with usuario_id and keeps it optional for older clients', () => {
    const api = harness();
    const user = api.post<{ id: string }>({ action: 'register', nombre: 'Ana', correo: 'ana@example.com', password: 'Clave123!' }).data;
    const owned = api.post<Registro>({ action: 'upsert', registro: expense({ usuario_id: user.id }) }).data;
    expect(owned.usuario_id).toBe(user.id);
    const legacy = api.post<Registro>({ action: 'upsert', registro: expense({ id: 'legacy-1' }) }).data;
    expect(legacy.usuario_id).toBe('');
  });
});

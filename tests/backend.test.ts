import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTotals } from '../src/lib/analytics';
import type { DataSet, Registro, Recurrente, Team, Deseo, TeamWallet } from '../src/types';

type Cell = string | number | boolean | Date;
type Envelope<T = unknown> = { ok: boolean; data: T; error?: string; service?: string };

class Sheet {
  values: Cell[][] = [];
  dataReads = 0;
  maxRows = 1000;
  constructor(readonly locked: () => boolean) {}
  getLastRow() { return this.values.length; }
  getLastColumn() { return (this.values[0] || []).length; }
  getMaxRows() { return this.maxRows; }
  setFrozenRows() { return this; }
  setColumnWidths() { return this; }
  insertRowsAfter(_row: number, count: number) { this.maxRows += count; }
  getDataRange() { this.dataReads++; return this.getRange(1, 1, this.values.length || 1, Math.max(1, ...this.values.map(row => row.length))); }
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
      setNumberFormat: () => range,
      setDataValidation: (validation?: { checkbox?: boolean }) => {
        // Sheets reales dejan FALSE (no '') en una celda con casilla nunca escrita.
        if (validation?.checkbox) {
          for (let r = 0; r < rowCount; r++) {
            const index = start - 1 + r;
            this.values[index] ??= [];
            if (this.values[index][col - 1] === undefined || this.values[index][col - 1] === '') this.values[index][col - 1] = false;
          }
        }
        return range;
      },
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
  const rule = { requireValueInList: () => rule, requireValueInRange: () => { rangeValidations++; return rule; }, setAllowInvalid: () => rule, requireCheckbox: () => checkboxRule, build: () => ({}) };
  const checkboxRule = { requireValueInList: () => rule, requireValueInRange: () => rule, setAllowInvalid: () => checkboxRule, requireCheckbox: () => checkboxRule, build: () => ({ checkbox: true }) };
  const source = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8')
    // Substitute declarations only in memory; configured user constants remain untouched on disk.
    .replace(/^const SPREADSHEET_ID = '[^']*';/m, "const SPREADSHEET_ID = 'test-sheet-id';");
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
    post<T>(request: object): Envelope<T> {
      context.request_ = { postData: { contents: JSON.stringify(request) } };
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

  it('keeps health public and rejects unknown actions before opening or writing the sheet', () => {
    const api = harness();
    expect(api.health()).toEqual({ ok: true, service: 'finanzas', version: 'Drip_API:V:0.0.0.07' });
    expect(api.post({ action: 'not-a-real-action' }).error).toBe('UNKNOWN_ACTION');
    expect(api.sheets.size).toBe(0);
    expect(api.lockCount).toBe(0);
  });

  it('creates exactly the specified sheets and preserves records on repeated setup', () => {
    const api = harness();
    api.setup();
    expect([...api.sheets.keys()]).toEqual(['Registros', 'Categorias', 'Deudas', 'Recurrentes', 'Config', 'Usuarios', 'Teams', 'Deseos', 'Votos', 'Comentarios', 'TeamWallets']);
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
    const realRow = sheet.values[1].slice();
    sheet.values[0][1] = 'renamed';
    expect(api.post({ action: 'list' }).error).toBe('SCHEMA_MISMATCH');
    expect(sheet.values[1]).toEqual(realRow);
  });

  it('treats a fully blank row in Registros as a logical deletion instead of blocking sync', () => {
    const api = harness();
    api.post({ action: 'upsert', registro: expense() });
    api.post({ action: 'upsert', registro: expense({ id: 'expense-2', actualizado_en: '2026-09-30T15:00:01.000Z' }) });
    const sheet = api.sheets.get('Registros')!;
    sheet.values.splice(2, 0, Array(sheet.values[0].length).fill(''));
    const listed = api.post<DataSet>({ action: 'list' });
    expect(listed.ok).toBe(true);
    expect(listed.data.registros.filter(r => !r.eliminado)).toHaveLength(2);
    expect(listed.data.registros.some(r => r.eliminado && r.id.startsWith('blank-row-'))).toBe(true);
  });

  it('still blocks sync for a partially filled row missing its id in Registros', () => {
    const api = harness();
    api.post({ action: 'upsert', registro: expense() });
    const sheet = api.sheets.get('Registros')!;
    const partial = Array(sheet.values[0].length).fill('');
    partial[1] = '2026-09-30';
    sheet.values.splice(2, 0, partial);
    const result = api.post({ action: 'list' });
    expect(result.error).toBe('SCHEMA_MISMATCH');
    expect(result.message).toContain('fila 3');
  });

  it('keeps throwing for a fully blank row in non-Registros tables', () => {
    const api = harness();
    expect(api.post({ action: 'list' }).ok).toBe(true);
    const sheet = api.sheets.get('Categorias')!;
    sheet.values.splice(2, 0, Array(sheet.values[0].length).fill(''));
    expect(api.post({ action: 'list' }).error).toBe('SCHEMA_MISMATCH');
  });

  it('ignores checkbox columns left at their default FALSE when detecting blank rows', () => {
    const api = harness();
    api.post({ action: 'upsert', registro: expense() });
    api.post({ action: 'upsert', registro: expense({ id: 'expense-2', actualizado_en: '2026-09-30T15:00:01.000Z' }) });
    const registros = api.sheets.get('Registros')!;
    // Una celda con casilla (checkbox) nunca escrita vale FALSE en Sheets, no ''.
    const blankWithCheckbox = Array(registros.values[0].length).fill('');
    blankWithCheckbox[14] = false; // columna 'eliminado'
    registros.values.splice(2, 0, blankWithCheckbox);
    const listed = api.post<DataSet>({ action: 'list' });
    expect(listed.ok).toBe(true);
    expect(listed.data.registros.filter(r => !r.eliminado)).toHaveLength(2);

    const categorias = api.sheets.get('Categorias')!;
    const trailingWithCheckbox = Array(categorias.values[0].length).fill('');
    trailingWithCheckbox[6] = false; // columna 'activa'
    categorias.values.push(trailingWithCheckbox);
    expect(api.post<DataSet>({ action: 'list' }).data.categorias).toHaveLength(15);
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

  it('creates an idempotent team with a complete API shape and one zero-balance wallet', () => {
    const api = harness();
    const user = api.post<{ id: string }>({ action: 'register', nombre: 'Ana', correo: 'ana@example.com', password: 'Clave123!' }).data;
    const command = { action: 'createTeam', id: 'team-viaje', nombre: 'Nuestro viaje', usuario_id: user.id };
    const first = api.post<Team>(command);
    expect(first.ok).toBe(true);
    expect(first.data).toMatchObject({ id: 'team-viaje', nombre: 'Nuestro viaje', creador_id: user.id, miembros: [user.id], activo: true });
    expect(first.data.creado_en).toBeTruthy();
    expect(api.post<Team>(command).data).toEqual(first.data);
    const listed = api.post<{ teams: Team[]; team_wallets: TeamWallet[] }>({ action: 'list', since: '2026-10-01T00:00:00.000Z' }).data;
    expect(listed.teams).toHaveLength(1);
    expect(listed.team_wallets).toHaveLength(1);
    expect(listed.team_wallets[0].saldo).toBe(0);
    expect(api.sheets.get('Teams')!.values[1][3]).toBe(JSON.stringify([user.id]));
  });

  it('preserves the original owner when an older client edits without usuario_id', () => {
    const api = harness();
    const original = api.post<Registro>({ action: 'upsert', registro: expense({ usuario_id: 'ana' }) }).data;
    const stamp = new Date(Date.parse(original.actualizado_en) + 1).toISOString();
    const edited = api.post<Registro>({ action: 'upsert', registro: expense({ monto: 9000, usuario_id: '', actualizado_en: stamp }) });
    expect(edited.ok).toBe(true);
    expect(edited.data).toMatchObject({ monto: 9000, usuario_id: 'ana' });
  });

  it('validates every invitation before writing and deduplicates comma-separated emails and retried team IDs', () => {
    const api = harness();
    const users = ['ana', 'luis', 'maria'].map(nombre => api.post<{ id: string }>({ action: 'register', nombre, correo: `${nombre}@example.com`, password: 'Clave123!' }).data.id);
    const command = { action: 'createTeam', id: 'bulk-team', nombre: 'Viaje', usuario_id: users[0], includeSnapshot: true };
    expect(api.post({ ...command, correos: 'luis@example.com, missing@example.com' }).error).toBe('USER_NOT_FOUND');
    expect(api.post<DataSet>({ action: 'list' }).data.teams).toEqual([]);
    const complete = { ...command, correos: ' Luis@example.com , maria@example.com, ana@example.com, luis@example.com' };
    const created = api.post<{ result: Team; snapshot: DataSet }>(complete);
    expect(created.ok).toBe(true);
    expect(created.data.result.miembros).toEqual(users);
    expect(created.data.snapshot.teams).toEqual([created.data.result]);
    expect(created.data.snapshot.team_wallets).toHaveLength(1);
    expect(api.post<{ result: Team }>(complete).data.result).toEqual(created.data.result);
    expect(api.post<DataSet>({ action: 'list' }).data.teams).toHaveLength(1);
  });

  it('writes a renamed debt category and returns its canonical snapshot in the same sync request', () => {
    const api = harness(); api.setup();
    const categories = api.post<DataSet>({ action: 'list' }).data.categorias;
    api.post({ action: 'saveEntity', entity: 'categoria', data: { ...categories.find(c => c.id === 'cat-deudas'), nombre: 'Créditos' } });
    api.post({ action: 'saveEntity', entity: 'deuda', data: { id: 'debt-1', nombre: 'Crédito', acreedor: '', monto_inicial: 1000, tasa_interes_mensual: 0, fecha_inicio: '2026-09-01', cuota_minima: 100, dia_pago: 1, activa: true } });
    const command = { action: 'sync', categorias: categories, operations: [{ action: 'upsert', registro: expense({ tipo: 'deuda_pago', subtipo: '', necesidad: '', categoria: 'Deudas', deuda_id: 'debt-1', usuario_id: 'same-user', monto: 100 }) }] };
    const result = api.post<{ registros: Registro[]; snapshot: DataSet & { syncProtocol: number } }>(command);
    expect(result.ok).toBe(true);
    expect(result.data.registros[0]).toMatchObject({ categoria: 'Créditos', usuario_id: 'same-user' });
    expect(result.data.snapshot.registros).toEqual(result.data.registros);
    expect(result.data.snapshot.syncProtocol).toBe(1);
    api.post(command);
    expect(api.post<DataSet>({ action: 'list' }).data.registros).toHaveLength(1);
  });

  it('reads each table once per list request and does not reuse financial snapshots between requests', () => {
    const api = harness(); api.setup();
    api.sheets.forEach(sheet => { sheet.dataReads = 0; });
    expect(api.post({ action: 'list' }).ok).toBe(true);
    api.sheets.forEach((sheet, name) => { expect(sheet.dataReads).toBe(name === 'Usuarios' ? 0 : 1); });
    const config = api.sheets.get('Config')!;
    config.values.find(row => row[0] === 'moneda')![1] = 'USD';
    expect(api.post<DataSet>({ action: 'list' }).data.config.moneda).toBe('USD');
  });

  it('loads existing Teams JSON members and string booleans without altering saved rows or wallets', () => {
    const api = harness();
    api.setup();
    const teams = api.sheets.get('Teams')!;
    const wallets = api.sheets.get('TeamWallets')!;
    teams.values[1] = ['existing-team', 'Ahorro casa', 'owner', '["partner","partner"]', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'TRUE'];
    teams.values[2] = ['inactive-team', 'Anterior', 'owner', '["owner"]', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'FALSE'];
    wallets.values[1] = ['existing-team', 123456, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'];
    const saved = teams.values[1].slice();
    const listed = api.post<{ teams: Team[]; team_wallets: TeamWallet[] }>({ action: 'list' }).data;
    expect(listed.teams[0].miembros).toEqual(['owner', 'partner']);
    expect(listed.teams[0].activo).toBe(true);
    expect(listed.teams[1].activo).toBe(false);
    expect(listed.team_wallets[0].saldo).toBe(123456);
    expect(teams.values[1]).toEqual(saved);
    api.setup();
    expect(teams.values[1]).toEqual(saved);
    expect(wallets.values[1][1]).toBe(123456);
  });

  it('keeps the creator visible when legacy membership JSON is malformed without rewriting it', () => {
    const api = harness();
    api.setup();
    const row: Cell[] = ['legacy-team', 'Pareja', 'owner', '[invalid', '', '', true];
    api.sheets.get('Teams')!.values[1] = row.slice();
    const listed = api.post<{ teams: Team[] }>({ action: 'list' });
    expect(listed.ok).toBe(true);
    expect(listed.data.teams[0].miembros).toEqual(['owner']);
    expect(api.sheets.get('Teams')!.values[1]).toEqual(row);
  });

  it('returns nested wish votes/comments and counts members instead of membership JSON characters', () => {
    const api = harness();
    const owner = api.post<{ id: string }>({ action: 'register', nombre: 'Ana', correo: 'ana@example.com', password: 'Clave123!' }).data.id;
    const partner = api.post<{ id: string }>({ action: 'register', nombre: 'Luis', correo: 'luis@example.com', password: 'Clave123!' }).data.id;
    const team = api.post<Team>({ action: 'createTeam', id: 'team-1', nombre: 'Pareja', usuario_id: owner }).data;
    const invitation = { action: 'inviteToTeam', team_id: team.id, correo: 'luis@example.com', usuario_id: owner };
    expect(api.post<Team>(invitation).data.miembros).toEqual([owner, partner]);
    expect(api.post<Team>(invitation).data.miembros).toEqual([owner, partner]);
    const wishCommand = { action: 'createWish', id: 'wish-1', team_id: team.id, titulo: 'Vacaciones', descripcion: 'Juntos', monto_objetivo: 1500000, usuario_id: owner };
    expect(api.post<Deseo>(wishCommand).data.votos).toEqual([]);
    api.post(wishCommand);
    expect(api.post<{ aprobado: boolean }>({ action: 'voteWish', deseo_id: 'wish-1', usuario_id: owner, tipo: 'like' }).data.aprobado).toBe(false);
    expect(api.post<{ aprobado: boolean }>({ action: 'voteWish', deseo_id: 'wish-1', usuario_id: partner, tipo: 'like' }).data.aprobado).toBe(true);
    const commentCommand = { action: 'addComment', id: 'comment-1', deseo_id: 'wish-1', usuario_id: partner, texto: 'Me encanta' };
    api.post(commentCommand); api.post(commentCommand);
    const listed = api.post<{ deseos: Deseo[] }>({ action: 'list' }).data;
    expect(listed.deseos).toHaveLength(1);
    expect(listed.deseos[0].votos).toHaveLength(2);
    expect(listed.deseos[0].comentarios).toHaveLength(1);
    expect(listed.deseos[0].aprobado).toBe(true);
    expect(api.post<{ aprobado: boolean }>({ action: 'voteWish', deseo_id: 'wish-1', usuario_id: partner, tipo: 'revision' }).data.aprobado).toBe(false);
  });


  it('journals a 50000 wish, partial contributions, personal liquidity and retries', () => {
    const api = harness();
    const owner = api.post<{ id: string }>({ action: 'register', nombre: 'Ana', correo: 'ana@example.com', password: 'Clave123!' }).data.id;
    const partner = api.post<{ id: string }>({ action: 'register', nombre: 'Luis', correo: 'luis@example.com', password: 'Clave123!' }).data.id;
    const team = api.post<Team>({ action: 'createTeam', nombre: 'Plan', usuario_id: owner }).data;
    api.post({ action: 'inviteToTeam', team_id: team.id, correo: 'luis@example.com', usuario_id: owner });
    const wish = api.post<Deseo>({ action: 'createWish', team_id: team.id, usuario_id: owner, titulo: 'Cena', monto_objetivo: 50000 }).data;
    const contribute = (id: string, usuario_id: string, monto: number) => api.post({ action: 'contributeWish', id, deseo_id: wish.id, usuario_id, monto });
    expect(contribute('before', partner, 10000).ok).toBe(false);
    for (const usuario_id of [owner, partner]) api.post({ action: 'voteWish', deseo_id: wish.id, usuario_id, tipo: 'like' });
    expect(contribute('first', partner, 10000).ok).toBe(true);
    expect(contribute('first', partner, 10000).ok).toBe(true);
    expect(contribute('over', partner, 20000).ok).toBe(false);
    expect(contribute('second', partner, 15000).ok).toBe(true);
    expect(contribute('owner', owner, 25000).ok).toBe(true);
    const data = api.post<DataSet>({ action: 'list' }).data;
    expect(data.deseos![0].monto_actual).toBe(50000);
    expect(getTotals(data.registros.filter(r => r.usuario_id === partner)).available).toBe(-25000);
    expect(getTotals(data.registros.filter(r => r.usuario_id === owner)).available).toBe(-25000);
    const budget = data.registros.find(r => r.id === 'wish-budget-' + wish.id)!;
    expect(budget.monto).toBe(50000);
    expect(api.post({ action: 'delete', id: budget.id }).ok).toBe(false);
    expect(api.post({ action: 'deleteWish', deseo_id: wish.id, usuario_id: partner }).error).toBe('UNAUTHORIZED');
    const deletion = { action: 'deleteWish', deseo_id: wish.id, usuario_id: owner };
    expect(api.post(deletion).ok).toBe(true);
    expect(api.post(deletion).ok).toBe(true);
    const after = api.post<DataSet>({ action: 'list' }).data;
    expect(after.deseos![0].eliminado).toBe(true);
    expect(after.registros).toEqual(data.registros);
    expect(contribute('deleted', owner, 1).error).toBe('NOT_FOUND');
  });

  it('saves categories without a monthly budget, including legacy payloads', () => {
    const api = harness(); api.setup();
    const category = { id: 'cat-new', nombre: 'Nueva', tipo: 'gasto', color: '#615BEA', icono: 'Wallet', activa: true };
    expect(api.post<{ presupuesto_mensual: number }>({ action: 'saveEntity', entity: 'categoria', data: category }).data.presupuesto_mensual).toBe(0);
    expect(api.post<{ presupuesto_mensual: number }>({ action: 'saveEntity', entity: 'categoria', data: { ...category, presupuesto_mensual: 50000 } }).data.presupuesto_mensual).toBe(0);
  });

  it('rejects a nonmember and insufficient wallet withdrawals without changing the balance', () => {
    const api = harness();
    const owner = api.post<{ id: string }>({ action: 'register', nombre: 'Ana', correo: 'ana@example.com', password: 'Clave123!' }).data.id;
    const outsider = api.post<{ id: string }>({ action: 'register', nombre: 'Luis', correo: 'luis@example.com', password: 'Clave123!' }).data.id;
    const team = api.post<Team>({ action: 'createTeam', nombre: 'Pareja', usuario_id: owner }).data;
    expect(api.post({ action: 'createWish', team_id: team.id, usuario_id: outsider, titulo: 'No', monto_objetivo: 100 }).error).toBe('UNAUTHORIZED');
    expect(api.post({ action: 'addToWallet', team_id: team.id, usuario_id: owner, monto: 100 }).ok).toBe(true);
    expect(api.post({ action: 'withdrawFromWallet', team_id: team.id, usuario_id: owner, monto: 200 }).error).toBe('INSUFFICIENT_FUNDS');
    expect(api.post<{ team_wallets: TeamWallet[] }>({ action: 'list' }).data.team_wallets[0].saldo).toBe(100);
  });
});

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { deleteRegistro, getAccount, importLocalRecords, materialize, mergeRegistros, readCache, saveConfig, saveEntity, saveRegistro, syncAccount, type Account, type Operation } from './client';
import { EMPTY_DATA } from '../lib/defaults';
import type { Categoria, Recurrente, Registro } from '../types';

const row = (id: string = crypto.randomUUID(), changes: Partial<Registro> = {}): Registro => ({
  id, fecha: '2026-09-30', tipo: 'gasto', subtipo: 'variable', monto: 6500, categoria: 'Comida fuera',
  tags: 'tinto', descripcion: 'Tinto', metodo_pago: 'efectivo', necesidad: 'innecesario',
  recurrente_id: '', deuda_id: '', creado_en: '2026-09-30T10:00:00.000Z', actualizado_en: '2026-09-30T10:00:00.000Z', eliminado: false, ...changes,
});
const connected = (): Promise<Account> => getAccount({ url: 'https://script.google.com/macros/s/TEST_DEPLOYMENT/exec', isDemo: false });
function response(data: unknown): Response { return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }

beforeEach(async () => { await clear(); vi.stubGlobal('navigator', { onLine: true }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('durable offline cache', () => {
  it('keeps concurrent optimistic writes and the pending queue in one durable transaction', async () => {
    const account = await connected();
    await Promise.all(Array.from({ length: 25 }, (_, index) => saveRegistro(account, row(`row-${index}`))));
    const state = await readCache(account);
    expect(state.data.registros).toHaveLength(25);
    expect(state.queue).toHaveLength(25);
    expect(new Set(state.data.registros.map(item => item.id)).size).toBe(25);
  });

  it('stores deletions as tombstones and survives reload', async () => {
    const account = await connected(); const original = row();
    await saveRegistro(account, original); await deleteRegistro(account, original.id);
    const state = await readCache(await connected());
    expect(state.data.registros[0].eliminado).toBe(true);
    expect(state.queue[1].operation.action).toBe('delete');
  });

  it('isolates other connections and demo from real financial data', async () => {
    const account = await connected(); await saveRegistro(account, row('private-row'));
    const other = await getAccount({ ...account.settings, url: 'https://script.google.com/macros/s/OTHER_DEPLOYMENT/exec' });
    const demo = await getAccount({ ...account.settings, isDemo: true });
    expect((await readCache(other)).data.registros).toHaveLength(0);
    expect((await readCache(demo)).data.registros.some(item => item.id === 'private-row')).toBe(false);
    expect((await readCache(demo)).queue).toHaveLength(0);
    expect(account.namespace).not.toContain(account.settings.url);
  });

  it('explicitly imports local-only records once while preserving the source', async () => {
    const local = await getAccount({ url: '', isDemo: false });
    await saveRegistro(local, row('offline-first'));
    const account = await connected();
    expect(await importLocalRecords(account)).toBe(1);
    expect(await importLocalRecords(account)).toBe(0);
    expect((await readCache(account)).data.registros[0].id).toBe('offline-first');
    expect((await readCache(local)).data.registros[0].id).toBe('offline-first');
  });
});

describe('synchronization', () => {
  it('retries an uncertain response with the same UUID and clears only acknowledged operations', async () => {
    const account = await connected(); await saveRegistro(account, row('same-uuid'));
    const server = new Map<string, Registro>(); let attempts = 0;
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      const payload = JSON.parse(String(options.body)) as { action: string; operations?: Operation[] };
      expect(options.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
      expect(options.redirect).toBe('follow');
      if (payload.action === 'batch') {
        for (const operation of payload.operations ?? []) if (operation.action === 'upsert') server.set(operation.registro.id, operation.registro);
        if (attempts++ === 0) throw new TypeError('Simulated dropped acknowledgement');
        return response({ registros: [...server.values()], serverTime: '2026-10-01T00:00:00.000Z' });
      }
      return response({ ...EMPTY_DATA, registros: [...server.values()], serverTime: '2026-10-01T00:00:00.000Z' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await syncAccount(account);
    expect(server.size).toBe(1);
    expect((await readCache(account)).queue).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('preserves and rebases a newer local edit made while a batch is in flight', async () => {
    const account = await connected(); const original = row('in-flight'); await saveRegistro(account, original);
    let release!: (value: Response) => void;
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const delayed = new Promise<Response>(resolve => { release = resolve; });
    let canonical = { ...original, actualizado_en: new Date(Date.now() + 5000).toISOString() };
    let first = true;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const payload = JSON.parse(String(options.body)) as { action: string; operations?: Operation[]; since?: string };
      if (payload.action === 'batch') {
        if (first) { first = false; started(); return delayed; }
        const operation = payload.operations?.[0];
        if (operation?.action === 'upsert') canonical = operation.registro;
        return response({ registros: [canonical], serverTime: canonical.actualizado_en });
      }
      return response({ ...EMPTY_DATA, registros: [canonical], serverTime: canonical.actualizado_en });
    }));
    const syncing = syncAccount(account); await began;
    await saveRegistro(account, { ...original, descripcion: 'Edited while sending', monto: 12000 });
    release(response({ registros: [canonical], serverTime: canonical.actualizado_en })); await syncing;
    const state = await readCache(account);
    expect(state.queue).toHaveLength(1);
    expect(state.data.registros[0].descripcion).toBe('Edited while sending');
    expect(state.data.registros[0].actualizado_en > canonical.actualizado_en).toBe(true);
    await syncAccount(account);
    expect((await readCache(account)).queue).toHaveLength(0);
    expect(canonical.monto).toBe(12000);
  });

  it('sends the list cursor only after a successful list and merges deletion tombstones', async () => {
    const account = await connected(); const original = row('server-deletion');
    let requestNumber = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const payload = JSON.parse(String(options.body)) as { since?: string };
      if (requestNumber++ === 0) { expect(payload.since).toBeUndefined(); return response({ ...EMPTY_DATA, registros: [original], serverTime: '2026-09-30T11:00:00.000Z' }); }
      expect(payload.since).toBe('2026-09-30T11:00:00.000Z');
      return response({ ...EMPTY_DATA, registros: [{ ...original, eliminado: true, actualizado_en: '2026-09-30T12:00:00.000Z' }], serverTime: '2026-09-30T12:00:01.000Z' });
    }));
    await syncAccount(account); await syncAccount(account);
    expect((await readCache(account)).data.registros[0].eliminado).toBe(true);
  });

  it('keeps pending operations after authentication failure without retrying credentials', async () => {
    const account = await connected(); await saveRegistro(account, row());
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(syncAccount(account)).rejects.toThrow('UNAUTHORIZED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await readCache(account)).queue).toHaveLength(1);
  });

  it('compacts all queued edits before splitting batches, sending the newest edit only once', async () => {
    const account = await connected();
    await saveRegistro(account, row('edited-many-times'));
    for (let index = 0; index < 52; index++) await saveRegistro(account, row(`other-${index}`));
    await saveRegistro(account, row('edited-many-times', { monto: 25000, descripcion: 'Correction after fifty operations' }));
    const server = new Map<string, Registro>(); const batches: Operation[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const payload = JSON.parse(String(options.body)) as { action: string; operations?: Operation[] };
      if (payload.action === 'batch') {
        batches.push(payload.operations ?? []);
        for (const operation of payload.operations ?? []) if (operation.action === 'upsert') server.set(operation.registro.id, operation.registro);
        return response({ registros: (payload.operations ?? []).flatMap(operation => operation.action === 'upsert' ? [operation.registro] : []), serverTime: new Date().toISOString() });
      }
      return response({ ...EMPTY_DATA, registros: [...server.values()], serverTime: new Date().toISOString() });
    }));
    await syncAccount(account);
    expect(batches.map(batch => batch.length)).toEqual([50, 3]);
    expect(batches.flat().filter(operation => operation.action === 'upsert' && operation.registro.id === 'edited-many-times')).toHaveLength(1);
    expect(server.get('edited-many-times')?.monto).toBe(25000);
    expect((await readCache(account)).queue).toHaveLength(0);
  });

  it('acknowledges a compacted never-uploaded insert/delete without resurrecting it', async () => {
    const account = await connected(); await saveRegistro(account, row('never-uploaded')); await deleteRegistro(account, 'never-uploaded');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const payload = JSON.parse(String(options.body)) as { action: string; operations?: Operation[] };
      if (payload.action === 'batch') {
        expect(payload.operations).toEqual([expect.objectContaining({ action: 'delete', id: 'never-uploaded' })]);
        return response({ registros: [], serverTime: new Date().toISOString() });
      }
      return response({ ...EMPTY_DATA, serverTime: new Date().toISOString() });
    }));
    await syncAccount(account);
    const state = await readCache(account);
    expect(state.queue).toHaveLength(0);
    expect(state.data.registros).toEqual([expect.objectContaining({ id: 'never-uploaded', eliminado: true })]);
  });

  it('renames categories in edits captured during the rename request before sending the queue', async () => {
    const account = await connected(); await saveRegistro(account, row('rename-flight'));
    const previous = (await readCache(account)).data.categorias.find(category => category.nombre === 'Comida fuera')!;
    const category: Categoria = { ...previous, nombre: 'Restaurantes y cafés' };
    let started!: () => void; let release!: (value: Response) => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const delayed = new Promise<Response>(resolve => { release = resolve; });
    let uploaded: Registro[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const payload = JSON.parse(String(options.body)) as { action: string; operations?: Operation[] };
      if (payload.action === 'saveEntity') { started(); return delayed; }
      if (payload.action === 'batch') {
        uploaded = (payload.operations ?? []).flatMap(operation => operation.action === 'upsert' ? [operation.registro] : []);
        expect(uploaded.every(record => record.categoria === category.nombre)).toBe(true);
        return response({ registros: uploaded, serverTime: new Date().toISOString() });
      }
      return response({ ...EMPTY_DATA, categorias: EMPTY_DATA.categorias.map(item => item.id === category.id ? category : item), registros: uploaded, serverTime: new Date().toISOString() });
    }));
    const saving = saveEntity(account, 'categoria', category); await began;
    await saveRegistro(account, row('rename-flight', { descripcion: 'Edited during rename', monto: 8200 }));
    release(response(category)); await saving;
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].descripcion).toBe('Edited during rename');
    expect((await readCache(account)).queue).toHaveLength(0);
  });

  it('does not let a stale server row erase an edit or pending deletion', () => {
    const local = row('merge', { descripcion: 'latest', actualizado_en: '2026-09-30T12:00:00.000Z' });
    expect(mergeRegistros([local], [row('merge')], [])[0].descripcion).toBe('latest');
    const merged = mergeRegistros([local], [local], [{ queueId: 'pending', operation: { action: 'delete', id: 'merge', actualizado_en: '2026-09-30T13:00:00.000Z' } }]);
    expect(merged[0].eliminado).toBe(true);
  });
});

describe('local validation and demo parity', () => {
  it('rejects invalid offline entries without poisoning the queue', async () => {
    const account = await connected();
    const invalid: Partial<Registro>[] = [{ monto: Number.NaN }, { monto: -1 }, { monto: 1e13 }, { fecha: '2026-02-30' }, { categoria: 'Missing category' }, { tipo: 'deuda_pago', subtipo: '', necesidad: '', deuda_id: 'missing-debt' }, { descripcion: 'a'.repeat(501) }, { recurrente_id: 'missing-template', subtipo: 'fijo' }];
    for (const changes of invalid) await expect(saveRegistro(account, row(undefined, changes))).rejects.toThrow();
    expect((await readCache(account)).queue).toHaveLength(0);
    expect((await readCache(account)).data.registros).toHaveLength(0);
    await saveRegistro(account, row('confirmed-day', { tipo: 'sin_gasto', subtipo: '', monto: 0, categoria: '', necesidad: '' }));
    expect((await readCache(account)).data.registros[0].categoria).toBe('Otros');
  });

  it('rejects invalid demo settings/entities and cascades a valid category rename', async () => {
    const demo = await getAccount({ url: '', isDemo: true });
    const original = (await readCache(demo)).data;
    const category = original.categorias.find(item => item.nombre === 'Servicios')!;
    await expect(saveConfig(demo, { ...original.config, dia_corte: 32 })).rejects.toThrow();
    await expect(saveEntity(demo, 'categoria', { ...category, color: 'bad' })).rejects.toThrow();
    await expect(saveEntity(demo, 'categoria', { ...category, nombre: 'Sueldo' })).rejects.toThrow();
    await saveRegistro(demo, row('demo-service', { categoria: 'Servicios' }));
    const template: Recurrente = { id: 'demo-template', descripcion: 'Internet', monto: 90000, categoria: 'Servicios', tags: 'casa', frecuencia: 'mensual', dia: 31, proximo_pago: '2026-01-31', metodo_pago: 'debito', activa: true };
    await saveEntity(demo, 'recurrente', template);
    await expect(saveEntity(demo, 'categoria', { ...category, tipo: 'ingreso' })).rejects.toThrow('utilizada');
    await saveEntity(demo, 'categoria', { ...category, nombre: 'Servicios del hogar' });
    const state = await readCache(demo);
    expect(state.data.registros.find(item => item.id === 'demo-service')?.categoria).toBe('Servicios del hogar');
    expect(state.data.recurrentes.find(item => item.id === template.id)?.categoria).toBe('Servicios del hogar');
    expect(state.queue).toHaveLength(0);
  });

  it('materializes demo occurrences with month-end clamping and never recreates tombstones', async () => {
    const demo = await getAccount({ url: '', isDemo: true });
    const template: Recurrente = { id: 'month-end-demo', descripcion: 'Pago fin de mes', monto: 100000, categoria: 'Servicios', tags: '', frecuencia: 'mensual', dia: 31, proximo_pago: '2026-01-31', metodo_pago: 'transferencia', activa: true };
    await saveEntity(demo, 'recurrente', template);
    await materialize(demo, '2026-03-31');
    let state = await readCache(demo);
    expect(state.data.registros.filter(item => item.recurrente_id === template.id).map(item => item.fecha)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(state.data.recurrentes.find(item => item.id === template.id)?.proximo_pago).toBe('2026-04-30');
    await deleteRegistro(demo, 'rec:month-end-demo:2026-02-28');
    await saveEntity(demo, 'recurrente', template);
    await materialize(demo, '2026-03-31');
    state = await readCache(demo);
    expect(state.data.registros.filter(item => item.recurrente_id === template.id)).toHaveLength(3);
    expect(state.data.registros.find(item => item.id === 'rec:month-end-demo:2026-02-28')?.eliminado).toBe(true);
    expect(state.queue).toHaveLength(0);
  });
});

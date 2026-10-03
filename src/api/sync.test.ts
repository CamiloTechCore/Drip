import 'fake-indexeddb/auto';
import { clear, set } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTeam, getAccount, normalizeTeam, parseInviteEmails, readCache, request, saveConfig, saveRegistro, selectUserData, syncAccount, type Account, type ListResponse, type Operation } from './client';
import { EMPTY_DATA } from '../lib/defaults';
import type { Registro, Team } from '../types';

const snapshot = (registros: Registro[] = []): ListResponse => ({ ...EMPTY_DATA, registros, teams: [], deseos: [], votos: [], comentarios: [], team_wallets: [], serverTime: new Date().toISOString(), syncProtocol: 1 });
const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));
const movement = (id = 'expense'): Registro => ({ id, fecha: '2026-10-02', monto: 100, categoria: 'Otros', tipo: 'gasto', subtipo: 'variable', necesidad: 'necesario', metodo_pago: 'efectivo', tags: '', descripcion: '', deuda_id: '', recurrente_id: '', creado_en: '', actualizado_en: '', eliminado: false, usuario_id: 'ana' });
let account: Account;
beforeEach(async () => {
  await clear(); vi.stubGlobal('navigator', { onLine: true });
  account = await getAccount({ url: 'https://script.google.com/macros/s/TEST/exec', isDemo: false });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('loads a fresh device then sends each movement with a single canonical sync request', async () => {
  const rows = new Map<string, Registro>();
  const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body)) as { action: string; operations: Operation[] };
    if (body.action === 'list') return response(snapshot([...rows.values()]));
    expect(body.action).toBe('sync');
    const written = body.operations.map(operation => {
      if (operation.action !== 'upsert') throw new Error('Unexpected delete');
      rows.set(operation.registro.id, operation.registro); return operation.registro;
    });
    return response({ registros: written, serverTime: new Date().toISOString(), snapshot: snapshot([...rows.values()]) });
  });
  vi.stubGlobal('fetch', fetchMock);
  await syncAccount(account, { full: true });
  fetchMock.mockClear();
  await saveRegistro(account, movement());
  await Promise.all(Array.from({ length: 5 }, () => syncAccount(account, { pendingOnly: true })));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((await readCache(account)).queue).toEqual([]);
  const mobile = { ...account, namespace: `${account.namespace}:mobile` };
  await syncAccount(mobile, { full: true });
  expect(selectUserData((await readCache(mobile)).data, 'ana')).toEqual(selectUserData((await readCache(account)).data, 'ana'));
});

it('keeps and rebases a newer offline edit when an older write is acknowledged with a snapshot', async () => {
  const cache = await readCache(account);
  await set(`drip:cache:v1:${account.namespace}`, { ...cache, syncProtocol: 1 });
  await saveRegistro(account, movement());
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    await saveRegistro(account, { ...movement(), monto: 250 });
    const canonical = { ...body.operations[0].registro, actualizado_en: new Date(Date.now() + 1000).toISOString() };
    return response({ registros: [canonical], snapshot: snapshot([canonical]) });
  }));
  await syncAccount(account);
  const state = await readCache(account);
  expect(state.queue).toHaveLength(1);
  expect(state.data.registros[0].monto).toBe(250);
  expect(Date.parse(state.data.registros[0].actualizado_en)).toBeGreaterThan(Date.now() + 900);
});

it.each([false, true])('recovers an owned local-only record unless the server has its deletion tombstone (%s)', async deleted => {
  const cache = await readCache(account);
  const saved = { ...movement(), creado_en: '2026-10-01T12:00:00.000Z', actualizado_en: '2026-10-01T12:00:00.000Z' };
  await set(`drip:cache:v1:${account.namespace}`, { ...cache, data: { ...cache.data, registros: [saved, { ...saved, id: 'unowned', usuario_id: '' }] } });
  const cloud = deleted ? [{ ...saved, eliminado: true, actualizado_en: new Date().toISOString() }] : [];
  const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    if (body.action === 'sync') {
      expect(body.operations).toHaveLength(1);
      expect(body.operations[0].registro.id).toBe(saved.id);
      cloud.push(body.operations[0].registro);
      return response({ registros: cloud, snapshot: snapshot(cloud) });
    }
    return response(snapshot(cloud));
  });
  vi.stubGlobal('fetch', fetchMock);
  await syncAccount(account, { full: true });
  expect(fetchMock).toHaveBeenCalledTimes(deleted ? 1 : 2);
  expect(cloud).toHaveLength(1);
  expect(cloud[0]).toMatchObject({ usuario_id: 'ana', eliminado: deleted });
  expect((await readCache(account)).queue).toEqual([]);
  expect((await readCache(account)).data.registros.some(row => row.id === 'unowned')).toBe(true);
});

it('never discards a pending write when a snapshot is malformed or an acknowledgement is missing', async () => {
  const cache = await readCache(account);
  await set(`drip:cache:v1:${account.namespace}`, { ...cache, syncProtocol: 1 });
  await saveRegistro(account, movement());
  const before = await readCache(account);
  vi.stubGlobal('fetch', vi.fn(async () => response({ registros: [], snapshot: snapshot() })));
  await expect(syncAccount(account)).rejects.toThrow('no confirmó');
  expect(await readCache(account)).toEqual(before);
  vi.stubGlobal('fetch', vi.fn(async () => response({ registros: before.data.registros, snapshot: { registros: [] } })));
  await expect(syncAccount(account)).rejects.toThrow('leer tus registros');
  expect(await readCache(account)).toEqual(before);
});

it('retries a lost acknowledgement with the same movement ID and does not duplicate the record', async () => {
  const cache = await readCache(account);
  await set(`drip:cache:v1:${account.namespace}`, { ...cache, syncProtocol: 1 });
  await saveRegistro(account, movement());
  const stored = new Map<string, Registro>();
  const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    const record = body.operations[0].registro as Registro;
    stored.set(record.id, record);
    if (fetchMock.mock.calls.length === 1) throw new Error('Lost acknowledgement');
    return response({ registros: [record], snapshot: snapshot([...stored.values()]) });
  });
  vi.stubGlobal('fetch', fetchMock);
  await syncAccount(account);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(stored.size).toBe(1);
  expect((await readCache(account)).queue).toEqual([]);
});

it('keeps a movement captured while an unrelated configuration write returns its snapshot', async () => {
  const cache = await readCache(account);
  await set(`drip:cache:v1:${account.namespace}`, { ...cache, syncProtocol: 1 });
  vi.stubGlobal('fetch', vi.fn(async () => {
    await saveRegistro(account, { ...movement(), monto: 250 });
    const canonical = { ...movement(), actualizado_en: new Date(Date.now() + 1000).toISOString() };
    return response({ result: EMPTY_DATA.config, snapshot: snapshot([canonical]) });
  }));
  await saveConfig(account, EMPTY_DATA.config);
  const state = await readCache(account);
  expect(state.queue).toHaveLength(1);
  expect(state.data.registros[0].monto).toBe(250);
});

it('normalizes legacy membership JSON and creates a team and invitations with one request', async () => {
  const team = { id: 'team', nombre: 'Viaje', creador_id: 'ana', miembros: '["ana","luis","luis"]', activo: true } as unknown as Team;
  expect(normalizeTeam(team).miembros).toEqual(['ana', 'luis']);
  expect(parseInviteEmails(' LUIS@example.com, maria@example.com, luis@example.com ')).toEqual(['luis@example.com', 'maria@example.com']);
  expect(() => parseInviteEmails('luis@example.com,mal')).toThrow();
  const cache = await readCache(account);
  await set(`drip:cache:v1:${account.namespace}`, { ...cache, syncProtocol: 1 });
  const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
    expect(JSON.parse(String(options.body))).toMatchObject({ action: 'createTeam', id: 'fixed-draft', correos: ['luis@example.com', 'maria@example.com'], includeSnapshot: true });
    return response({ result: team, snapshot: { ...snapshot(), teams: [team] } });
  });
  vi.stubGlobal('fetch', fetchMock);
  await createTeam(account, 'Viaje', 'ana', 'luis@example.com,maria@example.com', 'fixed-draft');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((await readCache(account)).data.teams?.[0].miembros).toHaveLength(2);
});

it('deduplicates simultaneous full hydration and bounds an unresponsive request to twenty seconds', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')));
  }));
  vi.stubGlobal('fetch', fetchMock);
  const pending = request(account, { action: 'list' });
  const rejected = expect(pending).rejects.toThrow('tardó demasiado');
  await vi.advanceTimersByTimeAsync(20_000);
  await rejected;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
  fetchMock.mockImplementation(async () => response(snapshot()));
  fetchMock.mockClear();
  await Promise.all([syncAccount(account, { full: true }), syncAccount(account, { full: true })]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

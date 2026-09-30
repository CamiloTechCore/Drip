import { get, update } from 'idb-keyval';
import { EMPTY_DATA } from '../lib/defaults';
import { createDemoData } from '../lib/demo';
import type { Config, DataSet, Entity, EntityName, Registro } from '../types';
import type { Settings } from '../store/settings';

export type Operation = { action: 'upsert'; registro: Registro } | { action: 'delete'; id: string; actualizado_en: string };
export interface QueuedOperation { queueId: string; operation: Operation }
export interface CacheState { version: 1; data: DataSet; queue: QueuedOperation[]; cursor: string | null }
export interface Account { namespace: string; settings: Settings }
type ListResponse = DataSet & { serverTime: string };
type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };
const listeners = new Set<(namespace: string) => void>();
const serial = new Map<string, Promise<unknown>>();
const LOCAL_INDEX = 'drip:unconfigured-stores:v1';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('drip-cache-v1') : null;
channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (typeof event.data === 'string') listeners.forEach(listener => listener(event.data as string));
});

export function subscribeCache(listener: (namespace: string) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
function publish(namespace: string): void {
  listeners.forEach(listener => listener(namespace)); channel?.postMessage(namespace);
}
function key(account: Account): string { return `drip:cache:v1:${account.namespace}`; }
function clone<T>(value: T): T { return structuredClone(value); }

export async function getAccount(settings: Settings): Promise<Account> {
  if (settings.isDemo) return { settings: { ...settings }, namespace: 'demo-v1' };
  const identity = JSON.stringify([settings.url, settings.token]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  const namespace = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (!settings.url || !settings.token) await update<string[]>(LOCAL_INDEX, stored => [...new Set([...(stored ?? []), namespace])]);
  return { settings: { ...settings }, namespace };
}

/** Web Locks serialize read/modify/write across tabs. The promise lock also covers browsers without it. */
async function locked<T>(name: string, work: () => Promise<T>): Promise<T> {
  const previous = serial.get(name) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request(name, work);
    return await work();
  });
  serial.set(name, next);
  try { return await next; } finally { if (serial.get(name) === next) serial.delete(name); }
}
function emptyState(account: Account): CacheState {
  return { version: 1, data: account.settings.isDemo ? createDemoData() : clone(EMPTY_DATA), queue: [], cursor: null };
}
export async function readCache(account: Account): Promise<CacheState> {
  return locked(`drip:store:${account.namespace}`, async () => {
    let state: CacheState = emptyState(account);
    // An IndexedDB readwrite transaction also protects older Safari without Web Locks.
    await update<CacheState>(key(account), stored => { state = stored?.version === 1 ? stored : state; return state; });
    return state;
  });
}
async function changeCache(account: Account, transform: (state: CacheState) => CacheState): Promise<CacheState> {
  const state = await locked(`drip:store:${account.namespace}`, async () => {
    let next: CacheState = emptyState(account);
    await update<CacheState>(key(account), stored => { next = transform(stored?.version === 1 ? stored : next); return next; });
    return next;
  });
  publish(account.namespace); return state;
}

function opId(operation: Operation): string { return operation.action === 'upsert' ? operation.registro.id : operation.id; }
export function pendingIds(state: CacheState): Set<string> { return new Set(state.queue.map(item => opId(item.operation))); }

/** Replay pending edits over canonical server rows so in-flight sync cannot erase a newer edit. */
export function mergeRegistros(local: Registro[], remote: Registro[], pending: QueuedOperation[]): Registro[] {
  const rows = new Map(local.map(row => [row.id, row]));
  remote.forEach(row => {
    const existing = rows.get(row.id);
    if (!existing || row.actualizado_en >= existing.actualizado_en) rows.set(row.id, row);
  });
  pending.forEach(({ operation }) => {
    if (operation.action === 'upsert') rows.set(operation.registro.id, operation.registro);
    else {
      const existing = rows.get(operation.id);
      if (existing) rows.set(operation.id, { ...existing, eliminado: true, actualizado_en: operation.actualizado_en });
    }
  });
  return [...rows.values()];
}

function nextTimestamp(existing?: string): string {
  return new Date(Math.max(Date.now(), existing ? Date.parse(existing) + 1 : 0)).toISOString();
}
export async function saveRegistro(account: Account, registro: Registro): Promise<void> {
  await changeCache(account, state => {
    const existing = state.data.registros.find(row => row.id === registro.id);
    const stamp = nextTimestamp(existing?.actualizado_en);
    const row = { ...registro, creado_en: existing?.creado_en || registro.creado_en || stamp, actualizado_en: stamp, eliminado: false };
    const operation: Operation = { action: 'upsert', registro: row };
    const queue = account.settings.isDemo ? [] : [...state.queue, { queueId: crypto.randomUUID(), operation }];
    return { ...state, queue, data: { ...state.data, registros: mergeRegistros(state.data.registros, [row], []) } };
  });
}
export async function deleteRegistro(account: Account, id: string): Promise<void> {
  await changeCache(account, state => {
    const existing = state.data.registros.find(row => row.id === id);
    if (!existing) throw new Error('El movimiento ya no existe en este dispositivo.');
    const operation: Operation = { action: 'delete', id, actualizado_en: nextTimestamp(existing.actualizado_en) };
    const queue = account.settings.isDemo ? [] : [...state.queue, { queueId: crypto.randomUUID(), operation }];
    return { ...state, queue, data: { ...state.data, registros: mergeRegistros(state.data.registros, [], [{ queueId: '', operation }]) } };
  });
}

function assertConnection(account: Account): void {
  if (!account.settings.url || !account.settings.token) throw new Error('Configura la URL y el token en Más → Ajustes. Tus movimientos quedan guardados en este dispositivo.');
  let url: URL;
  try { url = new URL(account.settings.url); } catch { throw new Error('La URL de Apps Script no es válida.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname)) throw new Error('Usa la URL HTTPS /exec de la implementación de Google Apps Script.');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Sin conexión. Los movimientos se sincronizarán cuando vuelva la red.');
}

export async function request<T>(account: Account, payload: Record<string, unknown>): Promise<T> {
  assertConnection(account);
  let lastError: Error = new Error('No fue posible conectar con Google Sheets.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(account.settings.url, {
        method: 'POST', redirect: 'follow', credentials: 'omit', signal: controller.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, token: account.settings.token }),
      });
      if (!response.ok) throw new Error('El servicio no respondió. Comprueba la implementación de Apps Script.');
      const result: ApiResponse<T> = await response.json() as ApiResponse<T>;
      if (!result || typeof result.ok !== 'boolean') throw new Error('La implementación no devolvió JSON válido. Revisa el acceso para cualquier usuario.');
      if (!result.ok) {
        const message = result.error === 'UNAUTHORIZED' ? 'El token de acceso es incorrecto. Revísalo en Ajustes.' : result.message || `El servidor rechazó la operación (${result.error}).`;
        // Validation and authorization failures are not transient.
        const error = new Error(message); error.name = 'ApiError'; throw error;
      }
      return result.data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Error de conexión.');
      if (lastError.name === 'ApiError') throw lastError;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 600 * 2 ** attempt));
    } finally { clearTimeout(timeout); }
  }
  throw new Error(lastError.name === 'AbortError' ? 'Google Sheets tardó demasiado. Tus cambios siguen guardados; vuelve a sincronizar.' : lastError.message);
}

export async function syncAccount(account: Account): Promise<void> {
  if (account.settings.isDemo) return;
  assertConnection(account);
  return locked(`drip:sync:${account.namespace}`, async () => {
    // Bound this pass; edits created while the request is in flight stay queued for the next pass.
    const snapshotIds = new Set((await readCache(account)).queue.map(item => item.queueId));
    while (true) {
      const sent = (await readCache(account)).queue.filter(item => snapshotIds.has(item.queueId)).slice(0, 50);
      if (!sent.length) break;
      const latest = new Map<string, Operation>();
      sent.forEach(item => latest.set(opId(item.operation), item.operation));
      const result = await request<{ registros: Registro[]; serverTime: string }>(account, { action: 'batch', operations: [...latest.values()] });
      const sentIds = new Set(sent.map(item => item.queueId));
      await changeCache(account, current => {
        const stamps = new Map(result.registros.map(row => [row.id, row.actualizado_en]));
        const queue = current.queue.filter(item => !sentIds.has(item.queueId)).map(item => {
          const id = opId(item.operation);
          const canonical = stamps.get(id);
          if (!canonical) return item;
          const previous = item.operation.action === 'upsert' ? item.operation.registro.actualizado_en : item.operation.actualizado_en;
          const stamp = new Date(Math.max(Date.parse(previous), Date.parse(canonical) + 1)).toISOString();
          stamps.set(id, stamp);
          const operation: Operation = item.operation.action === 'upsert'
            ? { action: 'upsert', registro: { ...item.operation.registro, actualizado_en: stamp } }
            : { ...item.operation, actualizado_en: stamp };
          return { ...item, operation };
        });
        const canonicalIds = new Set(result.registros.map(row => row.id));
        // Canonical acknowledgements replace optimistic timestamps, including clock skew.
        return { ...current, queue, data: { ...current.data, registros: mergeRegistros(current.data.registros.filter(row => !canonicalIds.has(row.id)), result.registros, queue) } };
      });
    }
    const beforeList = await readCache(account);
    const result = await request<ListResponse>(account, { action: 'list', ...(beforeList.cursor ? { since: beforeList.cursor } : {}) });
    await changeCache(account, current => ({
      ...current, cursor: result.serverTime,
      data: { categorias: result.categorias, deudas: result.deudas, recurrentes: result.recurrentes, config: result.config, registros: mergeRegistros(current.data.registros, result.registros, current.queue) },
    }));
  });
}

export async function saveEntity(account: Account, entity: EntityName, data: Entity): Promise<void> {
  if (account.settings.isDemo) {
    await changeCache(account, state => {
      const field = ({ categoria: 'categorias', deuda: 'deudas', recurrente: 'recurrentes' } as const)[entity];
      const rows: Entity[] = state.data[field];
      return { ...state, data: { ...state.data, [field]: [...rows.filter(row => row.id !== data.id), data] } };
    }); return;
  }
  await request(account, { action: 'saveEntity', entity, data }); await syncAccount(account);
}
export async function saveConfig(account: Account, config: Config): Promise<void> {
  if (account.settings.isDemo) { await changeCache(account, state => ({ ...state, data: { ...state.data, config } })); return; }
  await request(account, { action: 'saveConfig', config }); await syncAccount(account);
}
export async function materialize(account: Account): Promise<void> {
  if (account.settings.isDemo) return;
  // A backend pass is capped to keep Apps Script within its execution limits.
  for (let pass = 0; pass < 12; pass++) {
    const result = await request<{ pending: boolean }>(account, { action: 'materializeRecurrentes' });
    if (!result.pending) { await syncAccount(account); return; }
  }
  await syncAccount(account);
  throw new Error('Se generó una parte de los pagos pendientes. Vuelve a generar para continuar.');
}

/** Explicit, repeat-safe transfer from never-connected local stores; existing target IDs win. */
export async function importLocalRecords(account: Account): Promise<number> {
  if (account.settings.isDemo || !account.settings.url || !account.settings.token) throw new Error('Guarda primero la conexión y desactiva el modo demo para importar.');
  const namespaces = await get<string[]>(LOCAL_INDEX) ?? [];
  const sources: Registro[] = [];
  for (const namespace of namespaces) {
    if (namespace === account.namespace) continue;
    const stored = await get<CacheState>(`drip:cache:v1:${namespace}`);
    if (stored?.version === 1) sources.push(...stored.data.registros.filter(row => !row.eliminado));
  }
  let count = 0;
  await changeCache(account, state => {
    const ids = new Set(state.data.registros.map(row => row.id));
    const imported: Registro[] = [];
    for (const source of sources) {
      if (ids.has(source.id)) continue;
      ids.add(source.id); imported.push({ ...source, actualizado_en: nextTimestamp(source.actualizado_en) });
    }
    count = imported.length;
    const queue = [...state.queue, ...imported.map(registro => ({ queueId: crypto.randomUUID(), operation: { action: 'upsert', registro } as Operation }))];
    return { ...state, queue, data: { ...state.data, registros: [...state.data.registros, ...imported] } };
  });
  return count;
}

import { get, update } from 'idb-keyval';
import { EMPTY_DATA } from '../lib/defaults';
import { createDemoData } from '../lib/demo';
import { today } from '../lib/format';
import { validateConfig, validateEmail, validateEntity, validateLoginPassword, validateName, validatePassword, validateRegistro } from './validation';
import type { Categoria, Config, DataSet, Entity, EntityName, Recurrente, Registro, Usuario, Team, Deseo, Voto, Comentario, TeamWallet } from '../types';
import type { Settings } from '../store/settings';

export type Operation = { action: 'upsert'; registro: Registro } | { action: 'delete'; id: string; actualizado_en: string };
export interface QueuedOperation { queueId: string; operation: Operation }
export interface CacheState { version: 1; data: DataSet; queue: QueuedOperation[]; cursor: string | null }
export interface Account { namespace: string; settings: Settings }
export type ListResponse = DataSet & { serverTime: string };
export interface SyncOptions { full?: boolean }
type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };
export const MISSING_CONNECTION_MESSAGE = 'Este despliegue no tiene una conexión configurada. Añade VITE_APPS_SCRIPT_URL en las variables de entorno de Vercel y vuelve a desplegar.';
export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly hadTransportFailure = false) {
    super(message); this.name = 'ApiError';
  }
}
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
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(settings.url));
  const namespace = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (!settings.url) await update<string[]>(LOCAL_INDEX, stored => [...new Set([...(stored ?? []), namespace])]);
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
    await update<CacheState>(key(account), stored => {
      state = stored?.version === 1 ? { ...stored, data: mergeListData(stored.data, stored.data, stored.queue) } : state;
      return state;
    });
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
    const valid = validateRegistro(registro, state.data);
    const existing = state.data.registros.find(row => row.id === valid.id);
    const stamp = nextTimestamp(existing?.actualizado_en);
    const row = { ...valid, creado_en: existing?.creado_en || valid.creado_en || stamp, actualizado_en: stamp, eliminado: false };
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
  if (!account.settings.url) throw new Error(MISSING_CONNECTION_MESSAGE);
  let url: URL;
  try { url = new URL(account.settings.url); } catch { throw new Error('La URL de Apps Script no es válida.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname)) throw new Error('Usa la URL HTTPS /exec de la implementación de Google Apps Script.');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Sin conexión. Los movimientos se sincronizarán cuando vuelva la red.');
}

export async function request<T>(account: Account, payload: Record<string, unknown>, options: { retry?: boolean } = {}): Promise<T> {
  assertConnection(account);
  let lastError: Error = new Error('No fue posible conectar con Google Sheets.');
  let hadTransportFailure = false;
  const attempts = options.retry === false ? 1 : 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(account.settings.url, {
        method: 'POST', redirect: 'follow', credentials: 'omit', signal: controller.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const message = 'El servicio no respondió. Comprueba la URL /exec y el acceso para cualquier usuario de la implementación de Apps Script.';
        if (response.status < 500 && response.status !== 429) throw new ApiError('DEPLOYMENT_ERROR', message, hadTransportFailure);
        throw new Error(message);
      }
      const body = await response.text();
      let result: ApiResponse<T>;
      try { result = JSON.parse(body) as ApiResponse<T>; }
      catch { throw new ApiError('INVALID_RESPONSE', 'La conexión devolvió una página en lugar de datos. Revisa la URL /exec y que Apps Script permita el acceso a cualquier usuario.', hadTransportFailure); }
      if (!result || typeof result.ok !== 'boolean') throw new ApiError('INVALID_RESPONSE', 'La implementación no devolvió JSON válido. Revisa que esté publicada la versión actual de Apps Script.', hadTransportFailure);
      if (!result.ok) {
        const message = result.message || `El servidor rechazó la operación (${result.error}).`;
        // Validation and authorization failures are not transient.
        throw new ApiError(result.error, message, hadTransportFailure);
      }
      return result.data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Error de conexión.');
      if (lastError instanceof ApiError) throw lastError;
      hadTransportFailure = true;
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 600 * 2 ** attempt));
    } finally { clearTimeout(timeout); }
  }
  throw new Error(lastError.name === 'AbortError' ? 'Google Sheets tardó demasiado. Tus cambios siguen guardados; vuelve a sincronizar.' : lastError.message);
}

function publicUser(value: unknown): Usuario {
  if (!value || typeof value !== 'object') throw new ApiError('INVALID_RESPONSE', 'La implementación no devolvió una cuenta válida. Revisa que esté publicada la versión actual de Apps Script.');
  const user = value as Partial<Usuario>;
  if (typeof user.id !== 'string' || !user.id || typeof user.nombre !== 'string' || !user.nombre || typeof user.correo !== 'string' || !user.correo) throw new ApiError('INVALID_RESPONSE', 'La implementación no devolvió una cuenta válida. Revisa que esté publicada la versión actual de Apps Script.');
  return { id: user.id, nombre: user.nombre, correo: user.correo };
}
export async function registerUser(account: Account, input: { nombre: string; correo: string; password: string }): Promise<Usuario> {
  const valid = { nombre: validateName(input.nombre), correo: validateEmail(input.correo), password: validatePassword(input.password) };
  try { return publicUser(await request<unknown>(account, { action: 'register', ...valid })); }
  catch (error) {
    // A registration may have reached Sheets even when its acknowledgement was lost.
    // Confirm those same credentials; never overwrite or recreate an existing account.
    if (error instanceof ApiError && error.code === 'DUPLICATE_USER' && error.hadTransportFailure) {
      try { return await loginUser(account, valid); } catch { throw error; }
    }
    throw error;
  }
}
export async function loginUser(account: Account, input: { correo: string; password: string }): Promise<Usuario> {
  return publicUser(await request<unknown>(account, { action: 'login', correo: validateEmail(input.correo), password: validateLoginPassword(input.password) }));
}

export async function syncAccount(account: Account, options: SyncOptions = {}): Promise<void> {
  if (account.settings.isDemo) return;
  assertConnection(account);
  return locked(`drip:sync:${account.namespace}`, () => syncUnlocked(account, options));
}
async function syncUnlocked(account: Account, options: SyncOptions = {}): Promise<void> {
    // Read the canonical data first. Besides hydrating a new device, this gives
    // queued records the current category catalog before they are validated by
    // the server.
    const beforeSync = await readCache(account);
    // An incremental read can omit rows whose acknowledgement was lost long ago.
    const since = !options.full && !beforeSync.queue.length ? beforeSync.cursor : null;
    const initial = await request<ListResponse>(account, { action: 'list', ...(since ? { since } : {}) });
    if (!Array.isArray(initial?.registros) || !Array.isArray(initial.categorias) || !Number.isFinite(Date.parse(initial.serverTime))) {
      throw new ApiError('INVALID_RESPONSE', 'No pudimos leer tus registros. Revisa que Apps Script esté actualizado y vuelve a sincronizar.');
    }
    await changeCache(account, current => reconcilePending(current, beforeSync, initial, !since));

    // Bound this pass; edits created while the request is in flight stay queued for the next pass.
    const snapshotIds = new Set(beforeSync.queue.map(item => item.queueId));
    let sentBatch = false;
    while (true) {
      const eligible = (await readCache(account)).queue.filter(item => snapshotIds.has(item.queueId));
      if (!eligible.length) break;
      const latest = new Map<string, Operation>();
      eligible.forEach(item => latest.set(opId(item.operation), item.operation));
      const operations = [...latest.values()].slice(0, 50);
      const recordIds = new Set(operations.map(opId));
      // Compact the entire snapshot before chunking, then acknowledge every older edit of those IDs.
      const sent = eligible.filter(item => recordIds.has(opId(item.operation)));
      const result = await request<{ registros: Registro[]; serverTime: string }>(account, { action: 'batch', operations });
      sentBatch = true;
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
        const acknowledged = new Set(current.queue.filter(item => sentIds.has(item.queueId)).map(item => opId(item.operation)));
        const canonicalIds = new Set(result.registros.filter(row => acknowledged.has(row.id)).map(row => row.id));
        // Canonical acknowledgements replace optimistic timestamps, including clock skew.
        return { ...current, queue, data: { ...current.data, registros: mergeRegistros(current.data.registros.filter(row => !canonicalIds.has(row.id)), result.registros, queue) } };
      });
    }
    if (!sentBatch) return;
    const beforeList = await readCache(account);
    const result = await request<ListResponse>(account, { action: 'list', ...(beforeList.cursor ? { since: beforeList.cursor } : {}) });
    await changeCache(account, current => ({ ...current, cursor: result.serverTime, data: mergeListData(current.data, result, current.queue) }));
}

/** Confirm lost acknowledgements by ID and version/content, never by ID alone. */
function reconcilePending(current: CacheState, snapshot: CacheState, incoming: ListResponse, fullSnapshot: boolean): CacheState {
    const categories = incoming.categorias;
    const remote = new Map(incoming.registros.map(row => [row.id, row]));
    const snapshotIds = new Set(snapshot.queue.map(item => item.queueId));
    const latest = new Map<string, Operation>();
    snapshot.queue.forEach(item => latest.set(opId(item.operation), item.operation));
    const validCategory = (row: Registro) => categories.some(category => category.nombre === row.categoria
      && (row.tipo !== 'ingreso' && row.tipo !== 'gasto' || category.tipo === row.tipo));
    const fields = ['fecha', 'tipo', 'subtipo', 'monto', 'categoria', 'tags', 'descripcion', 'metodo_pago', 'necesidad', 'recurrente_id', 'deuda_id', 'eliminado', 'usuario_id'] as const;
    const confirmed = new Set<string>();
    latest.forEach((operation, id) => {
      const canonical = remote.get(id);
      if (!canonical) return;
      const stamp = operation.action === 'upsert' ? operation.registro.actualizado_en : operation.actualizado_en;
      const serverVersion = Date.parse(canonical.actualizado_en);
      const localVersion = Date.parse(stamp);
      const alreadyApplied = operation.action === 'delete' ? canonical.eliminado : fields.every(field => {
        // A corrected server category must not resurrect the stale invalid one.
        if (field === 'categoria' && !validCategory(operation.registro) && validCategory(canonical)) return true;
        return (operation.registro[field] ?? '') === (canonical[field] ?? '');
      });
      if (serverVersion >= localVersion || alreadyApplied) confirmed.add(id);
    });
    const fallback = (tipo: 'ingreso' | 'gasto') => categories.find(category => category.nombre === 'Otros' && category.tipo === tipo)
      ?? categories.find(category => category.tipo === tipo && category.activa)
      ?? categories.find(category => category.tipo === tipo);
    const stamps = new Map(incoming.registros.filter(row => confirmed.has(row.id)).map(row => [row.id, row.actualizado_en]));
    const queue: QueuedOperation[] = current.queue
      .filter(item => !snapshotIds.has(item.queueId) || !confirmed.has(opId(item.operation)))
      .map(item => {
      // A concurrent edit must stay newer than the canonical acknowledgement.
      const canonicalStamp = stamps.get(opId(item.operation));
      if (canonicalStamp) {
        const previous = item.operation.action === 'upsert' ? item.operation.registro.actualizado_en : item.operation.actualizado_en;
        const stamp = new Date(Math.max(Date.parse(previous), Date.parse(canonicalStamp) + 1)).toISOString();
        stamps.set(opId(item.operation), stamp);
        item = { ...item, operation: item.operation.action === 'upsert'
          ? { action: 'upsert', registro: { ...item.operation.registro, actualizado_en: stamp } }
          : { ...item.operation, actualizado_en: stamp } };
      }
      if (!snapshotIds.has(item.queueId) || item.operation.action !== 'upsert') return item;
      const row = item.operation.registro;
      const requiredType = row.tipo === 'ingreso' ? 'ingreso' : 'gasto';
      if (validCategory(row)) return item;
      const previous = snapshot.data.categorias.find(category => category.nombre === row.categoria);
      const renamed = categories.find(category => category.id === previous?.id && category.tipo === requiredType);
      const canonical = remote.get(row.id);
      const replacement = renamed ?? (canonical && validCategory(canonical)
        ? categories.find(category => category.nombre === canonical.categoria && category.tipo === requiredType) : undefined)
        ?? fallback(requiredType);
      if (!replacement) return item;
      const registro = { ...row, categoria: replacement.nombre };
      return { ...item, operation: { action: 'upsert', registro } };
    });
    // Replace optimistic timestamps for confirmed records, then replay newer edits.
    // A complete read repairs ownership/clock skew for the rows actually read.
    // Never erase device-only history just because a server snapshot is empty.
    // Pending edits still override canonical rows below, including deletions.
    const canonicalIds = new Set(incoming.registros.map(row => row.id));
    const base = { ...current.data, registros: current.data.registros.filter(row => fullSnapshot
      ? !canonicalIds.has(row.id) : !confirmed.has(row.id)) };
    return { ...current, queue, cursor: incoming.serverTime, data: mergeListData(base, incoming, queue) };
}

function members(value: unknown, fallback: string[] = []): string[] {
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) as unknown; } catch { return fallback; }
  }
  return Array.isArray(parsed) ? [...new Set(parsed.filter((member): member is string => typeof member === 'string' && member.length > 0))] : fallback;
}
export function normalizeTeam(team: Team, previous?: Team): Team {
  return {
    ...previous, ...team,
    miembros: members(team.miembros, previous?.miembros ?? (team.creador_id ? [team.creador_id] : [])),
    creado_en: team.creado_en ?? previous?.creado_en ?? '',
    actualizado_en: team.actualizado_en ?? previous?.actualizado_en ?? '',
    activo: typeof team.activo === 'boolean' ? team.activo : team.activo === undefined ? previous?.activo ?? true : String(team.activo).toLowerCase() === 'true',
  };
}
function hydrateWish(wish: Deseo, votes?: Voto[], comments?: Comentario[], previous?: Deseo): Deseo {
  return {
    ...previous, ...wish,
    votos: Array.isArray(wish.votos) ? wish.votos : votes ? votes.filter(vote => vote.deseo_id === wish.id) : previous?.votos ?? [],
    comentarios: Array.isArray(wish.comentarios) ? wish.comentarios : comments ? comments.filter(comment => comment.deseo_id === wish.id) : previous?.comentarios ?? [],
  };
}
/** Only registros are incremental. Optional collaborative arrays are full snapshots when supplied. */
export function mergeListData(current: DataSet, incoming: DataSet, queue: QueuedOperation[] = []): DataSet {
  const next: DataSet = {
    ...current,
    categorias: incoming.categorias ?? current.categorias,
    deudas: incoming.deudas ?? current.deudas,
    recurrentes: incoming.recurrentes ?? current.recurrentes,
    config: incoming.config ?? current.config,
    registros: mergeRegistros(current.registros, incoming.registros ?? [], queue),
  };
  if (Array.isArray(incoming.teams)) next.teams = incoming.teams.map(team => normalizeTeam(team, current.teams?.find(existing => existing.id === team.id)));
  if (Array.isArray(incoming.votos)) next.votos = incoming.votos;
  if (Array.isArray(incoming.comentarios)) next.comentarios = incoming.comentarios;
  if (Array.isArray(incoming.team_wallets)) next.team_wallets = incoming.team_wallets;
  if (Array.isArray(incoming.deseos)) {
    next.deseos = incoming.deseos.map(wish => hydrateWish(wish, incoming.votos, incoming.comentarios, current.deseos?.find(existing => existing.id === wish.id)));
  } else if (current.deseos && (Array.isArray(incoming.votos) || Array.isArray(incoming.comentarios))) {
    next.deseos = current.deseos.map(wish => ({
      ...wish,
      votos: Array.isArray(incoming.votos) ? incoming.votos.filter(vote => vote.deseo_id === wish.id) : wish.votos,
      comentarios: Array.isArray(incoming.comentarios) ? incoming.comentarios.filter(comment => comment.deseo_id === wish.id) : wish.comentarios,
    }));
  }
  return next;
}

export async function listData(account: Account): Promise<ListResponse> {
  const result = await request<ListResponse>(account, { action: 'list' });
  const current = await readCache(account);
  return { ...mergeListData(current.data, result, current.queue), serverTime: result.serverTime };
}

export function selectUserData(data: DataSet, userId: string | undefined, isDemo = false): DataSet {
  if (isDemo) return data;
  if (!userId) return EMPTY_DATA;
  const teams = data.teams?.filter(team => team.creador_id === userId || members(team.miembros).includes(userId));
  const teamIds = new Set(teams?.map(team => team.id));
  const deseos = data.deseos?.filter(wish => teamIds.has(wish.team_id));
  const wishIds = new Set(deseos?.map(wish => wish.id));
  return {
    ...data, registros: data.registros.filter(record => record.usuario_id === userId),
    ...(teams ? { teams } : {}), ...(deseos ? { deseos } : {}),
    ...(data.votos ? { votos: data.votos.filter(vote => !!vote.deseo_id && wishIds.has(vote.deseo_id)) } : {}),
    ...(data.comentarios ? { comentarios: data.comentarios.filter(comment => !!comment.deseo_id && wishIds.has(comment.deseo_id)) } : {}),
    ...(data.team_wallets ? { team_wallets: data.team_wallets.filter(wallet => teamIds.has(wallet.team_id)) } : {}),
  };
}

function applyEntity(state: CacheState, entity: EntityName, data: Entity): CacheState {
  const field = ({ categoria: 'categorias', deuda: 'deudas', recurrente: 'recurrentes' } as const)[entity];
  const rows: Entity[] = state.data[field];
  const next = { ...state, data: { ...state.data, [field]: [...rows.filter(row => row.id !== data.id), data] } };
  if (entity !== 'categoria') return next;
  const previous = state.data.categorias.find(category => category.id === data.id);
  const category = data as Categoria;
  if (!previous || previous.nombre === category.nombre) return next;
  const rename = (row: Registro): Registro => row.categoria === previous.nombre ? { ...row, categoria: category.nombre } : row;
  next.data.registros = next.data.registros.map(rename);
  next.data.recurrentes = next.data.recurrentes.map(template => template.categoria === previous.nombre ? { ...template, categoria: category.nombre } : template);
  next.queue = state.queue.map(item => {
    if (item.operation.action !== 'upsert' || item.operation.registro.categoria !== previous.nombre) return item;
    const renamed = { ...rename(item.operation.registro), actualizado_en: nextTimestamp(item.operation.registro.actualizado_en) };
    return { ...item, operation: { action: 'upsert', registro: renamed } };
  });
  next.data.registros = mergeRegistros(next.data.registros, [], next.queue);
  return next;
}

export async function saveEntity(account: Account, entity: EntityName, data: Entity): Promise<void> {
  if (account.settings.isDemo) {
    await changeCache(account, state => applyEntity(state, entity, validateEntity(entity, data, state.data))); return;
  }
  await locked(`drip:sync:${account.namespace}`, async () => {
    const current = await readCache(account);
    const valid = validateEntity(entity, data, current.data);
    const canonical = await request<Entity>(account, { action: 'saveEntity', entity, data: valid });
    await changeCache(account, state => applyEntity(state, entity, canonical));
    await syncUnlocked(account);
  });
}
export async function saveConfig(account: Account, config: Config): Promise<void> {
  const valid = validateConfig(config);
  if (account.settings.isDemo) { await changeCache(account, state => ({ ...state, data: { ...state.data, config: valid } })); return; }
  await locked(`drip:sync:${account.namespace}`, async () => {
    const canonical = await request<Config>(account, { action: 'saveConfig', config: valid });
    await changeCache(account, state => ({ ...state, data: { ...state.data, config: canonical } }));
    await syncUnlocked(account);
  });
}
function nextRecurringDate(date: string, template: Recurrente): string {
  const [year, month, day] = date.split('-').map(Number);
  if (template.frecuencia === 'semanal' || template.frecuencia === 'quincenal') return new Date(Date.UTC(year, month - 1, day + (template.frecuencia === 'semanal' ? 7 : 15))).toISOString().slice(0, 10);
  const nextYear = year + (template.frecuencia === 'anual' ? 1 : 0);
  const nextMonth = month - 1 + (template.frecuencia === 'mensual' ? 1 : 0);
  const last = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(nextYear, nextMonth, Math.min(template.dia, last))).toISOString().slice(0, 10);
}
export async function materialize(account: Account, through = today()): Promise<void> {
  if (account.settings.isDemo) {
    let remaining = false;
    await changeCache(account, state => {
      const records = [...state.data.registros];
      const existing = new Set(records.filter(row => row.recurrente_id).map(row => `${row.recurrente_id}|${row.fecha}`));
      let processed = 0;
      const recurrentes = state.data.recurrentes.map(template => {
        if (!template.activa) return template;
        let cursor = template.proximo_pago;
        while (cursor <= through && processed < 6000) {
          const occurrence = `${template.id}|${cursor}`;
          if (!existing.has(occurrence)) {
            const stamp = new Date().toISOString();
            records.push(validateRegistro({ id: `rec:${template.id}:${cursor}`, fecha: cursor, tipo: 'gasto', subtipo: 'fijo', monto: template.monto, categoria: template.categoria, tags: template.tags, descripcion: template.descripcion, metodo_pago: template.metodo_pago, necesidad: 'necesario', recurrente_id: template.id, deuda_id: '', eliminado: false, creado_en: stamp, actualizado_en: stamp }, state.data));
            existing.add(occurrence);
          }
          processed++; cursor = nextRecurringDate(cursor, template);
        }
        if (cursor <= through) remaining = true;
        return { ...template, proximo_pago: cursor };
      });
      return { ...state, data: { ...state.data, registros: records, recurrentes } };
    });
    if (remaining) throw new Error('Se generó una parte de los pagos pendientes. Vuelve a generar para continuar.');
    return;
  }
  await locked(`drip:sync:${account.namespace}`, async () => {
    // A backend pass is capped to keep Apps Script within its execution limits.
    for (let pass = 0; pass < 12; pass++) {
      const result = await request<{ pending: boolean }>(account, { action: 'materializeRecurrentes' });
      if (!result.pending) { await syncUnlocked(account); return; }
    }
    await syncUnlocked(account);
    throw new Error('Se generó una parte de los pagos pendientes. Vuelve a generar para continuar.');
  });
}

/** Explicit, repeat-safe transfer from never-connected local stores; existing target IDs win. */
export async function importLocalRecords(account: Account): Promise<number> {
  if (account.settings.isDemo || !account.settings.url) throw new Error('Guarda primero la conexión y desactiva el modo demo para importar.');
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
      ids.add(source.id); imported.push({ ...validateRegistro(source, state.data), actualizado_en: nextTimestamp(source.actualizado_en) });
    }
    count = imported.length;
    const queue = [...state.queue, ...imported.map(registro => ({ queueId: crypto.randomUUID(), operation: { action: 'upsert', registro } as Operation }))];
    return { ...state, queue, data: { ...state.data, registros: [...state.data.registros, ...imported] } };
  });
  return count;
}

// Teams and Wishes API functions
function upsertItem<T extends { id: string }>(rows: T[] | undefined, item: T): T[] {
  return [...(rows ?? []).filter(row => row.id !== item.id), item];
}
async function cacheTeam(account: Account, value: Team): Promise<Team> {
  let team = value;
  await changeCache(account, state => {
    team = normalizeTeam(value, state.data.teams?.find(existing => existing.id === value.id));
    return { ...state, data: { ...state.data, teams: upsertItem(state.data.teams, team) } };
  });
  return team;
}
export async function createTeam(account: Account, nombre: string, usuario_id: string): Promise<Team> {
  const result = await request<Team>(account, { action: 'createTeam', id: crypto.randomUUID(), nombre, usuario_id });
  return cacheTeam(account, result);
}

export async function inviteToTeam(account: Account, team_id: string, correo: string, usuario_id: string): Promise<Team> {
  return cacheTeam(account, await request<Team>(account, { action: 'inviteToTeam', team_id, correo, usuario_id }));
}

export async function createWish(account: Account, team_id: string, titulo: string, descripcion: string, monto_objetivo: number, usuario_id: string): Promise<Deseo> {
  const result = await request<Deseo>(account, { action: 'createWish', id: crypto.randomUUID(), team_id, titulo, descripcion, monto_objetivo, usuario_id });
  let wish = result;
  await changeCache(account, state => {
    wish = hydrateWish(result, state.data.votos, state.data.comentarios, state.data.deseos?.find(existing => existing.id === result.id));
    return { ...state, data: { ...state.data, deseos: upsertItem(state.data.deseos, wish) } };
  });
  return wish;
}

export async function voteWish(account: Account, deseo_id: string, tipo: 'like' | 'dislike' | 'revision', usuario_id: string): Promise<{ deseo_id: string; tipo: string; aprobado: boolean }> {
  const result = await request<{ deseo_id: string; tipo: string; aprobado: boolean }>(account, { action: 'voteWish', deseo_id, tipo, usuario_id });
  await changeCache(account, state => ({ ...state, data: { ...state.data, deseos: state.data.deseos?.map(wish => wish.id === result.deseo_id ? { ...wish, aprobado: result.aprobado } : wish) } }));
  return result;
}

export async function addComment(account: Account, deseo_id: string, texto: string, usuario_id: string): Promise<Comentario> {
  const result = await request<Comentario>(account, { action: 'addComment', id: crypto.randomUUID(), deseo_id, texto, usuario_id });
  const comment = { ...result, deseo_id: result.deseo_id ?? deseo_id };
  await changeCache(account, state => ({ ...state, data: {
    ...state.data, comentarios: upsertItem(state.data.comentarios, comment),
    deseos: state.data.deseos?.map(wish => wish.id === deseo_id ? { ...wish, comentarios: upsertItem(wish.comentarios, comment) } : wish),
  } }));
  return comment;
}

async function cacheWallet(account: Account, value: { team_id: string; saldo: number }): Promise<void> {
  await changeCache(account, state => {
    const previous = state.data.team_wallets?.find(wallet => wallet.team_id === value.team_id);
    const wallet: TeamWallet = { creado_en: previous?.creado_en ?? '', actualizado_en: previous?.actualizado_en ?? '', ...value };
    return { ...state, data: { ...state.data, team_wallets: [...(state.data.team_wallets ?? []).filter(existing => existing.team_id !== value.team_id), wallet] } };
  });
}
export async function addToWallet(account: Account, team_id: string, monto: number, usuario_id: string): Promise<{ team_id: string; saldo: number }> {
  const result = await request<{ team_id: string; saldo: number }>(account, { action: 'addToWallet', team_id, monto, usuario_id }, { retry: false });
  await cacheWallet(account, result); return result;
}

export async function withdrawFromWallet(account: Account, team_id: string, monto: number, usuario_id: string): Promise<{ team_id: string; saldo: number }> {
  const result = await request<{ team_id: string; saldo: number }>(account, { action: 'withdrawFromWallet', team_id, monto, usuario_id }, { retry: false });
  await cacheWallet(account, result); return result;
}

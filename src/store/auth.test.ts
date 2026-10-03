import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const user = { id: 'same-user', nombre: 'Ana', correo: 'ana@example.com' };
let browser: EventTarget;
let page: EventTarget & { visibilityState: string };
let stored: Map<string, string>;
let stop: (() => void) | undefined;

beforeEach(async () => {
  await clear();
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
  browser = new EventTarget();
  page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  stored = new Map();
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', page);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    removeItem: (key: string) => { stored.delete(key); },
    setItem: (key: string, value: string) => { stored.set(key, value); },
  });
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('document-lifetime session', () => {
  it('keeps IndexedDB records and pending operations intact when the session expires', async () => {
    const auth = await import('./auth');
    const cached = { data: { registros: [{ id: 'offline-record', usuario_id: user.id }] }, queue: [{ queueId: 'unsent-operation' }] };
    const cacheKey = 'drip:cache:v1:session-test';
    await set(cacheKey, cached);
    stop = auth.watchSession(vi.fn());
    auth.setUser(user);
    vi.advanceTimersByTime(auth.SESSION_IDLE_MS);
    expect(auth.getUser()).toBeNull();
    expect(await get(cacheKey)).toEqual(cached);
  });

  it('discards legacy persistent login and never persists a new authenticated identity', async () => {
    stored.set('drip:auth:v1', JSON.stringify(user));
    stored.set('unrelated-settings', 'keep');
    const auth = await import('./auth');
    expect(auth.getUser()).toBeNull();
    expect(stored.has('drip:auth:v1')).toBe(false);
    auth.setUser(user);
    expect(auth.getUser()).toEqual(user);
    expect(stored.size).toBe(1);
    expect(stored.get('unrelated-settings')).toBe('keep');
    vi.resetModules();
    expect((await import('./auth')).getUser()).toBeNull();
  });

  it('closes on page exit and cannot revive the identity through BFCache pageshow', async () => {
    const auth = await import('./auth');
    const reload = vi.fn();
    stop = auth.watchSession(reload);
    auth.setUser(user);
    browser.dispatchEvent(new Event('pagehide'));
    browser.dispatchEvent(new Event('pageshow'));
    expect(auth.getUser()).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('signs out and requests exactly one reload at thirty minutes, not before', async () => {
    const auth = await import('./auth');
    const reload = vi.fn();
    stop = auth.watchSession(reload);
    auth.setUser(user);
    vi.advanceTimersByTime(auth.SESSION_IDLE_MS - 1);
    expect(auth.getUser()).toEqual(user);
    vi.advanceTimersByTime(1);
    expect(auth.getUser()).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(auth.SESSION_IDLE_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('renews the idle deadline for actual interaction but not focus or background visibility', async () => {
    const auth = await import('./auth');
    const reload = vi.fn();
    stop = auth.watchSession(reload);
    auth.setUser(user);
    vi.advanceTimersByTime(20 * 60 * 1000);
    browser.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(20 * 60 * 1000);
    browser.dispatchEvent(new Event('focus'));
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    browser.dispatchEvent(new Event('pointermove'));
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(auth.getUser()).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each(['visibilitychange', 'focus', 'pageshow', 'pointerdown'])('checks wall time on %s after suspended mobile timers', async event => {
    const auth = await import('./auth');
    const reload = vi.fn();
    stop = auth.watchSession(reload);
    auth.setUser(user);
    vi.setSystemTime(new Date(Date.now() + auth.SESSION_IDLE_MS + 1));
    (event === 'visibilitychange' ? page : browser).dispatchEvent(new Event(event));
    expect(auth.getUser()).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('cancels timers on manual logout and removes event handlers during cleanup', async () => {
    const auth = await import('./auth');
    const reload = vi.fn();
    stop = auth.watchSession(reload);
    auth.setUser(user);
    auth.setUser(null);
    expect(vi.getTimerCount()).toBe(0);
    expect(reload).not.toHaveBeenCalled();
    auth.setUser(user);
    stop(); stop = undefined;
    expect(vi.getTimerCount()).toBe(0);
    browser.dispatchEvent(new Event('pagehide'));
    expect(auth.getUser()).toEqual(user);
  });
});

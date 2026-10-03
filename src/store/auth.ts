import { useSyncExternalStore } from 'react';
import type { Usuario } from '../types';

const STORAGE_KEY = 'drip:auth:v1';
export const SESSION_IDLE_MS = 30 * 60 * 1000;
const listeners = new Set<() => void>();

function clearLegacyIdentity(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be disabled. */ }
}

// Never restore a signed-in identity after a browser/tab restart or reload.
// IndexedDB financial data and pending operations are intentionally untouched.
clearLegacyIdentity();
let current: Usuario | null = null;
let lastActivity = 0;
export const getUser = (): Usuario | null => current;

/** Authentication is confined to this document's lifetime, not durable storage. */
export function setUser(user: Usuario | null): void {
  clearLegacyIdentity();
  current = user;
  lastActivity = user ? Date.now() : 0;
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Wall-clock checks also expire sessions when mobile timers were suspended. */
export function watchSession(onExpire: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    if (current) timer = setTimeout(check, Math.max(0, SESSION_IDLE_MS - (Date.now() - lastActivity)));
  };
  const check = () => {
    if (current && Date.now() - lastActivity >= SESSION_IDLE_MS) {
      setUser(null);
      onExpire();
      return;
    }
    schedule();
  };
  const activity = () => {
    // A first interaction after suspension must not revive an expired session.
    check();
    if (current && document.visibilityState !== 'hidden') {
      lastActivity = Date.now();
      schedule();
    }
  };
  const close = () => setUser(null); // Includes BFCache navigation/restoration.
  const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll'] as const;
  events.forEach(event => window.addEventListener(event, activity, { capture: true, passive: true }));
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  window.addEventListener('pagehide', close);
  document.addEventListener('visibilitychange', check);
  const unsubscribe = subscribe(schedule);
  check();
  return () => {
    clearTimeout(timer);
    unsubscribe();
    events.forEach(event => window.removeEventListener(event, activity, true));
    window.removeEventListener('focus', check);
    window.removeEventListener('pageshow', check);
    window.removeEventListener('pagehide', close);
    document.removeEventListener('visibilitychange', check);
  };
}

export function useAuth() {
  const user = useSyncExternalStore(subscribe, getUser, getUser);
  return { user, setUser };
}

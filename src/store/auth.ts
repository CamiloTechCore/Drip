import { useSyncExternalStore } from 'react';
import type { Usuario } from '../types';

const STORAGE_KEY = 'drip:auth:v1';
const listeners = new Set<() => void>();

function readUser(): Usuario | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const stored = value as Partial<Usuario>;
    if (typeof stored.id !== 'string' || typeof stored.nombre !== 'string' || typeof stored.correo !== 'string') return null;
    return { id: stored.id, nombre: stored.nombre, correo: stored.correo };
  } catch { return null; }
}

let current = readUser();
export const getUser = (): Usuario | null => current;

/** The signed-in identity stays on this device, separate from the shared connection token. */
export function setUser(user: Usuario | null): void {
  if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  else localStorage.removeItem(STORAGE_KEY);
  current = user;
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY) { current = readUser(); listeners.forEach(listener => listener()); }
});

export function useAuth() {
  const user = useSyncExternalStore(subscribe, getUser, getUser);
  return { user, setUser };
}

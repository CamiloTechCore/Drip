import { useSyncExternalStore } from 'react';

export interface Settings { url: string; isDemo: boolean }
const STORAGE_KEY = 'drip:settings:v1';
const listeners = new Set<() => void>();
const environmentUrl = (import.meta.env.VITE_APPS_SCRIPT_URL ?? '').trim();

function readSettings(): Settings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const stored = value && typeof value === 'object' ? value as Partial<Settings> : {};
    // The URL always comes from VITE_APPS_SCRIPT_URL; a stale stored value (even '') must never shadow it.
    return { url: environmentUrl, isDemo: stored.isDemo === true };
  } catch { return { url: environmentUrl, isDemo: false }; }
}

let current = readSettings();
export const getSettings = (): Settings => current;

/** Only isDemo is persisted here; the connection URL is never read from or written to storage. */
export function setSettings(next: Partial<Settings>): void {
  const candidate = { url: environmentUrl, isDemo: next.isDemo ?? current.isDemo };
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ isDemo: candidate.isDemo }));
  current = candidate;
  listeners.forEach(listener => listener());
}

export function setDemo(isDemo: boolean): void { setSettings({ isDemo }); }
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY) { current = readSettings(); listeners.forEach(listener => listener()); }
});

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, getSettings, getSettings);
  return { ...settings, setSettings, setDemo };
}

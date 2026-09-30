import { useSyncExternalStore } from 'react';

export interface Settings { url: string; token: string; isDemo: boolean }
const STORAGE_KEY = 'drip:settings:v1';
const listeners = new Set<() => void>();
const environmentUrl = import.meta.env.VITE_APPS_SCRIPT_URL ?? '';

function readSettings(): Settings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const stored = value && typeof value === 'object' ? value as Partial<Settings> : {};
    return { url: typeof stored.url === 'string' ? stored.url : environmentUrl, token: typeof stored.token === 'string' ? stored.token : '', isDemo: stored.isDemo === true };
  } catch { return { url: environmentUrl, token: '', isDemo: false }; }
}

let current = readSettings();
export const getSettings = (): Settings => current;

/** The shared token stays on this device; it is never part of an environment variable. */
export function setSettings(next: Partial<Settings>): void {
  const candidate = { ...current, ...next };
  candidate.url = candidate.url.trim();
  candidate.token = candidate.token.trim();
  // Persist before publishing: callers can report blocked browser storage accurately.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
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

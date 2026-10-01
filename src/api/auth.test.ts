import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, loginUser, MISSING_CONNECTION_MESSAGE, registerUser, type Account } from './client';
import { validateLoginPassword, validatePassword } from './validation';

const account: Account = { namespace: 'auth-test-only', settings: { url: 'https://script.google.com/macros/s/TEST_DEPLOYMENT/exec', isDemo: false } };
const user = { id: 'existing-user-id', nombre: 'Ana', correo: 'ana@example.com' };
const signup = { nombre: ' Ana ', correo: ' ANA@EXAMPLE.COM ', password: 'Clave123!' };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { vi.stubGlobal('navigator', { onLine: true }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('existing account login', () => {
  it('accepts a legacy password without applying the registration policy and preserves its exact characters', async () => {
    const password = ' old1 ';
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      expect(JSON.parse(String(options.body))).toEqual({ action: 'login', correo: user.correo, password });
      expect(options.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
      return json({ ok: true, data: user });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(validateLoginPassword(password)).toBe(password);
    expect(() => validatePassword(password)).toThrow();
    await expect(loginUser(account, { correo: ' ANA@example.com ', password })).resolves.toEqual(user);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects empty or oversized credentials before contacting the server', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(loginUser(account, { correo: 'invalid', password: 'old1' })).rejects.toThrow('correo');
    await expect(loginUser(account, { correo: user.correo, password: '' })).rejects.toThrow('contraseña');
    await expect(loginUser(account, { correo: user.correo, password: 'a'.repeat(201) })).rejects.toThrow('contraseña');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry a rejected password and keeps the generic authentication message', async () => {
    const fetchMock = vi.fn(async () => json({ ok: false, error: 'UNAUTHORIZED', message: 'Correo o contraseña incorrectos.' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loginUser(account, { correo: user.correo, password: 'old1' })).rejects.toThrow('Correo o contraseña incorrectos.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('only exposes the existing public identity and rejects malformed account responses', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ ok: true, data: { ...user, password_hash: 'must-never-be-stored', salt: 'private' } })).mockResolvedValueOnce(json({ ok: true, data: { id: user.id } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loginUser(account, { correo: user.correo, password: 'old1' })).resolves.toEqual(user);
    await expect(loginUser(account, { correo: user.correo, password: 'old1' })).rejects.toThrow('cuenta válida');
  });
});

describe('registration without changing existing accounts', () => {
  it('still enforces the new-account password policy before sending a request', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(registerUser(account, { ...signup, password: 'old1' })).rejects.toThrow('contraseña');
    await expect(registerUser(account, { ...signup, nombre: '' })).rejects.toThrow('nombre');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recovers the same account when registration succeeded but its acknowledgement was lost', async () => {
    const actions: string[] = [];
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      const input = JSON.parse(String(options.body)) as { action: string; correo: string; password: string; nombre?: string };
      actions.push(input.action);
      expect(input.correo).toBe(user.correo); expect(input.password).toBe(signup.password);
      if (actions.length === 1) { expect(input.nombre).toBe(user.nombre); throw new TypeError('Lost acknowledgement after commit'); }
      if (input.action === 'register') return json({ ok: false, error: 'DUPLICATE_USER', message: 'Ya existe una cuenta con ese correo.' });
      return json({ ok: true, data: user });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(registerUser(account, signup)).resolves.toEqual(user);
    expect(actions).toEqual(['register', 'register', 'login']);
  });

  it('does not try logging into an existing account after a normal duplicate response', async () => {
    const fetchMock = vi.fn(async () => json({ ok: false, error: 'DUPLICATE_USER', message: 'Ya existe una cuenta con ese correo.' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(registerUser(account, signup)).rejects.toMatchObject({ code: 'DUPLICATE_USER', hadTransportFailure: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never treats a duplicate as success if recovery credentials are rejected', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Connection lost')).mockResolvedValueOnce(json({ ok: false, error: 'DUPLICATE_USER', message: 'Ya existe una cuenta con ese correo.' })).mockResolvedValueOnce(json({ ok: false, error: 'UNAUTHORIZED', message: 'Correo o contraseña incorrectos.' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(registerUser(account, signup)).rejects.toMatchObject({ code: 'DUPLICATE_USER', hadTransportFailure: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('deployment diagnostics', () => {
  it('explains how to configure a missing Vercel connection without requesting inaccessible app settings', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(loginUser({ ...account, settings: { ...account.settings, url: '' } }, { correo: user.correo, password: 'old1' })).rejects.toThrow(MISSING_CONNECTION_MESSAGE);
    expect(MISSING_CONNECTION_MESSAGE).toContain('VITE_APPS_SCRIPT_URL');
    expect(MISSING_CONNECTION_MESSAGE).not.toContain('Más');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains an Apps Script HTML/access page instead of leaking a JSON parse error or retrying it', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>Google authorization page</html>', { headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loginUser(account, { correo: user.correo, password: 'old1' })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

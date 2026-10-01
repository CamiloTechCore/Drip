import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
function check(endpoint: string) {
  return spawnSync(process.execPath, ['scripts/check-deployment-env.mjs'], {
    cwd: root,
    env: { ...process.env, VITE_APPS_SCRIPT_URL: endpoint },
    encoding: 'utf8',
  });
}

describe('Vercel deployment configuration', () => {
  it.each([
    '',
    'https://docs.google.com/spreadsheets/d/example/edit',
    'https://script.google.com/macros/s/valid-example/dev',
    'https://script.google.com/macros/s/XXXXXXXX/exec',
  ])('rejects an unusable API setting before publishing: %s', value => {
    const result = check(value);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('VITE_APPS_SCRIPT_URL');
  });

  it('accepts an exec endpoint without requesting it or printing its value', () => {
    const endpoint = 'https://script.google.com/macros/s/example-deployment-123/exec';
    const result = check(endpoint);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('configurada');
    expect(result.stdout + result.stderr).not.toContain(endpoint);
  });
});

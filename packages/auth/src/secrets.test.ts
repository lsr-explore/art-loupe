import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readAppEnv, resolveSecret } from './secrets';

// @trace flow=platform.auth category=security
describe('resolveSecret', () => {
  const originalEnv = { ...process.env };
  let scratch: string;
  let secretsDir: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'artloupe-secrets-'));
    secretsDir = join(scratch, 'run-secrets');
    mkdirSync(secretsDir);
    // `delete`, not `= undefined`: assigning to process.env stores the string "undefined".
    delete process.env.APP_ENV;
    delete process.env.EXAMPLE_SECRET;
    delete process.env.EXAMPLE_SECRET_FILE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(scratch, { recursive: true, force: true });
  });

  it('reads a secret mounted at the default path', () => {
    writeFileSync(join(secretsDir, 'example_secret'), 'from-mount\n');

    expect(resolveSecret('EXAMPLE_SECRET', { secretsDir })).toBe('from-mount');
  });

  it('reads the file named by <NAME>_FILE', () => {
    const elsewhere = join(scratch, 'elsewhere');
    writeFileSync(elsewhere, 'from-configured-path\n');
    process.env.EXAMPLE_SECRET_FILE = elsewhere;

    expect(resolveSecret('EXAMPLE_SECRET', { secretsDir })).toBe('from-configured-path');
  });

  it('prefers a mounted file over the environment', () => {
    writeFileSync(join(secretsDir, 'example_secret'), 'from-mount\n');
    process.env.EXAMPLE_SECRET = 'from-env';

    expect(resolveSecret('EXAMPLE_SECRET', { secretsDir })).toBe('from-mount');
  });

  it.each(['local', 'docker', 'ci'])('reads the environment under APP_ENV=%s', (appEnv) => {
    process.env.APP_ENV = appEnv;
    process.env.EXAMPLE_SECRET = 'from-env';

    expect(resolveSecret('EXAMPLE_SECRET', { secretsDir })).toBe('from-env');
  });

  it('never reads the environment in production', () => {
    process.env.APP_ENV = 'production';
    process.env.EXAMPLE_SECRET = 'from-env';

    expect(resolveSecret('EXAMPLE_SECRET', { secretsDir })).toBeUndefined();
  });

  it('throws when a configured path cannot be read', () => {
    process.env.EXAMPLE_SECRET_FILE = join(scratch, 'absent');

    expect(() => resolveSecret('EXAMPLE_SECRET', { secretsDir })).toThrow('could not be read');
  });

  it('throws on an empty secret file', () => {
    writeFileSync(join(secretsDir, 'example_secret'), '\n');

    expect(() => resolveSecret('EXAMPLE_SECRET', { secretsDir })).toThrow('is empty');
  });

  it('reads a rotated file on the next call', () => {
    const mounted = join(secretsDir, 'example_secret');
    writeFileSync(mounted, 'first\n');
    expect(resolveSecret('EXAMPLE_SECRET', { secretsDir })).toBe('first');

    writeFileSync(mounted, 'rotated\n');
    expect(resolveSecret('EXAMPLE_SECRET', { secretsDir })).toBe('rotated');
  });

  it('rejects an unrecognised APP_ENV rather than treating it as local', () => {
    process.env.APP_ENV = 'prod';

    expect(() => readAppEnv()).toThrow('APP_ENV must be one of');
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where a server-side secret comes from: the Node half of `artloupe.config`'s seam.
 *
 * A secret is anything that grants access. First match wins:
 *
 * 1. **A mounted file.** The path is `<NAME>_FILE` when that is set, and
 *    `/run/secrets/<name>` otherwise. This is how Docker, Kubernetes and Cloud Run
 *    deliver secrets.
 * 2. **The process environment, outside production only.** A developer's
 *    `.env.local` and the e2e config hold throwaway values that protect nothing, so
 *    `local` and `ci` may read them. `APP_ENV=production` never does.
 *
 * There is no keychain step: the Node secrets are local-only values on a developer
 * machine. Paid provider keys live on the Python side, which has one.
 */

export type AppEnv = 'local' | 'ci' | 'production';

const APP_ENVS: readonly AppEnv[] = ['local', 'ci', 'production'];

/** Docker Compose mounts its secrets here; other platforms set `<NAME>_FILE` instead. */
export const SECRETS_DIR = '/run/secrets';

/**
 * The declared environment. Defaults to `local`, like the Python side.
 *
 * An unrecognised value throws rather than falling back to `local`, where a typo
 * such as `prod` would quietly let a deployed server read secrets from its environment.
 */
export const readAppEnv = (): AppEnv => {
  const declared = process.env.APP_ENV ?? 'local';
  const known = APP_ENVS.find((candidate) => candidate === declared);

  if (!known) {
    throw new Error(`APP_ENV must be one of ${APP_ENVS.join(', ')}; got "${declared}".`);
  }

  return known;
};

const readSecretFile = (name: string, secretsDir: string): string | undefined => {
  const fileVar = `${name}_FILE`;
  const configured = process.env[fileVar];
  const target = configured ?? join(secretsDir, name.toLowerCase());

  if (!configured && !existsSync(target)) {
    return undefined;
  }

  let value: string;

  try {
    value = readFileSync(target, 'utf8').trim();
  } catch (error) {
    throw new Error(
      `The secret file for ${name} at ${target} could not be read. Check the mount, or ${fileVar}.`,
      { cause: error },
    );
  }

  if (!value) {
    throw new Error(`The secret file for ${name} at ${target} is empty.`);
  }

  return value;
};

/**
 * Resolve one secret, or `undefined` when nothing provides it.
 *
 * Read on every call rather than cached, so a rotated file takes effect without a
 * restart. A configured file that cannot be read throws: that is a mistake to fix,
 * not a missing value.
 */
export const resolveSecret = (
  name: string,
  { secretsDir = SECRETS_DIR }: { secretsDir?: string } = {},
): string | undefined => {
  const appEnv = readAppEnv();
  const fromFile = readSecretFile(name, secretsDir);

  if (fromFile !== undefined) {
    return fromFile;
  }

  if (appEnv === 'production') {
    return undefined;
  }

  return process.env[name] || undefined;
};

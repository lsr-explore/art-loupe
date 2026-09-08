import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type Route, test } from '@playwright/test';
import {
  type ApiErrorBody,
  type CreateProjectResponse,
  FILE_FIELD,
  PROJECTS_ENDPOINT,
  type UploadRejection,
} from '../src/lib/api/project-contract';

/**
 * Intake, in a real browser, with the upload stubbed at the network boundary.
 *
 * **The stub is a decision, not a shortcut.** `demoAuthProvider` returns no `tokens` by
 * construction, so `getAccessToken()` is null and `POST /api/projects` answers 401 for any demo
 * session — and the CI Playwright job has no Supabase in it to answer with instead. So a suite
 * that let the request through would assert that intake is broken. The handler's own behaviour
 * is covered by its unit suite and by a live end-to-end run against real Supabase; what only a
 * browser can decide is what is asserted here: does the form assemble the right multipart
 * request, does each refusal become something an artist can act on, and does the error surface
 * take focus.
 *
 * The known weakness of stubbing is that the form-to-route contract is then checked against a
 * fixture. It is narrowed by importing the endpoint, the field names and both body types from
 * `src/lib/api/project-contract` — the same declarations `route.ts` answers with — and by
 * `apps/studio/tsconfig.json` now typechecking `e2e/`, so a renamed field fails `pnpm typecheck`
 * rather than passing quietly here.
 */

const DEMO_USER = 'demo@demo.artloupestudio.com';
const DEMO_PASSWORD = 'demo-pass';

const PROJECT_ID = '3f1c9b4e-2d7a-4c05-9f8b-6a1e0d2c4b57';
const CHECKSUM = 'a'.repeat(64);

/** A 1×1 PNG. The server decodes bytes; the stub never does, so the smallest valid one will do. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const signIn = async (page: Page) => {
  await page.goto('/en');
  await page.getByLabel('Artist ID').fill(DEMO_USER);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/home$/);
};

const openIntake = async (page: Page) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Start a project' }).click();
  await expect(page).toHaveURL(/\/en\/projects\/new$/);
};

/** Answer the upload with a given status and body. Registered before the form is submitted. */
const stubUpload = async (page: Page, status: number, body: unknown) => {
  await page.route(`**${PROJECTS_ENDPOINT}`, (route: Route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );
};

const created = (): CreateProjectResponse => ({ projectId: PROJECT_ID, checksum: CHECKSUM });
const refused = (reason: UploadRejection): ApiErrorBody => ({ error: 'invalid_upload', reason });

const fillIntake = async (page: Page, { goal = 'likeness over finish' } = {}) => {
  await page.getByLabel('Reference photograph').setInputFiles({
    name: 'studio-reference.png',
    mimeType: 'image/png',
    buffer: PNG_BYTES,
  });
  await page.getByLabel('Medium').selectOption('graphite');
  await page.getByLabel('Time available').fill('180');
  await page.getByLabel('Width').fill('9');
  await page.getByLabel('Height').fill('12');
  await page.getByLabel('Units').selectOption('in');
  await page.getByLabel('Skill level').selectOption('advanced');
  await page.getByLabel('What are you after?').fill(goal);
};

const submit = (page: Page) => page.getByRole('button', { name: 'Start the project' }).click();

/**
 * The error summary, matched by its accessible name.
 *
 * A bare `getByRole('alert')` is ambiguous here: Next's own route announcer
 * (`#__next-route-announcer__`) is an assertive alert region on every page, so it and the
 * summary both match and the locator is strict-mode violated after a client navigation.
 */
const errorSummary = (page: Page) => page.getByRole('alert', { name: 'There is a problem' });

test.describe('Intake', {
  annotation: [
    { type: 'flow', description: 'intake.project-intent' },
    { type: 'category', description: 'functionality' },
  ],
}, () => {
  test('builds the multipart request the upload route expects', async ({ page }) => {
    await openIntake(page);

    const upload = page.waitForRequest((request) => request.url().includes(PROJECTS_ENDPOINT));
    await stubUpload(page, 201, created());
    await fillIntake(page);
    await submit(page);

    const request = await upload;
    expect(request.method()).toBe('POST');

    // Playwright does not parse multipart, so the parts are read out of the raw body. That is
    // the point of asserting here at all: this is the only place the *browser's* encoding of
    // the form is observed, rather than a FormData a test built itself.
    const body = request.postData() ?? '';
    expect(body).toContain(`name="${FILE_FIELD}"`);
    expect(body).toContain('filename="studio-reference.png"');

    const intent = /name="intent"\r?\n\r?\n([\s\S]*?)\r?\n--/.exec(body)?.[1];
    expect(intent).toBeDefined();
    expect(JSON.parse(intent as string)).toEqual({
      medium: 'graphite',
      time_budget_minutes: 180,
      support: { width: 9, height: 12, units: 'in' },
      skill_level: 'advanced',
      goal: 'likeness over finish',
    });
  });

  test('opens the created project on a 201', async ({ page }) => {
    await openIntake(page);
    await stubUpload(page, 201, created());

    await fillIntake(page);
    await submit(page);

    await expect(page).toHaveURL(new RegExp(`/en/projects/${PROJECT_ID}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Reference photograph received',
    );
    // The page must not imply a plan exists. It is the honest half of shipping this early.
    await expect(page.getByText(/not built yet/i)).toBeVisible();
  });

  test('validates in the browser before anything is uploaded', async ({ page }) => {
    await openIntake(page);

    let uploaded = false;
    await page.route(`**${PROJECTS_ENDPOINT}`, (route: Route) => {
      uploaded = true;
      return route.fulfill({ status: 201, body: JSON.stringify(created()) });
    });

    await submit(page);

    const summary = errorSummary(page);
    await expect(summary).toBeVisible();
    await expect(summary.getByRole('link', { name: /choose the medium/i })).toBeVisible();
    expect(uploaded).toBe(false);
  });

  test('moves focus to the error summary so the failure is announced', async ({ page }) => {
    await openIntake(page);
    await submit(page);

    await expect(errorSummary(page)).toBeFocused();

    // Following a summary link is how a keyboard user gets to the field it names.
    await page.getByRole('link', { name: /choose the medium/i }).click();
    await expect(page).toHaveURL(/#intake-medium$/);
  });

  const REFUSALS: [UploadRejection, RegExp][] = [
    ['below_min_dimension', /at least 800 px/i],
    ['unsupported_type', /not a JPEG, PNG or WebP/i],
    ['undecodable', /could not be read as an image/i],
    ['too_large', /over 25 MB/i],
  ];

  for (const [reason, expected] of REFUSALS) {
    test(`explains the refusal ${reason} in words an artist can act on`, async ({ page }) => {
      await openIntake(page);
      await stubUpload(page, 422, refused(reason));

      await fillIntake(page);
      await submit(page);

      await expect(errorSummary(page).getByText(expected)).toBeVisible();
      await expect(page).toHaveURL(/\/en\/projects\/new$/);
      // The form is usable again: a refusal is not a dead end.
      await expect(page.getByRole('button', { name: 'Start the project' })).toBeEnabled();
    });
  }

  test('reports a duplicate upload without pretending it failed', async ({ page }) => {
    await openIntake(page);
    await stubUpload(page, 409, { error: 'conflict' } satisfies ApiErrorBody);

    await fillIntake(page);
    await submit(page);

    await expect(errorSummary(page).getByText(/already uploaded/i)).toBeVisible();
  });

  test('reports an expired session rather than a generic failure', async ({ page }) => {
    await openIntake(page);
    await stubUpload(page, 401, { error: 'unauthenticated' } satisfies ApiErrorBody);

    await fillIntake(page);
    await submit(page);

    await expect(errorSummary(page).getByText(/session has ended/i)).toBeVisible();
  });

  test('renders the form in Spanish on the Spanish route', {
    annotation: [{ type: 'flow', description: 'platform.shell' }],
  }, async ({ page }) => {
    await signIn(page);
    await page.goto('/es/projects/new');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Iniciar un proyecto');
    await expect(page.getByLabel('Fotografía de referencia')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Iniciar el proyecto' })).toBeVisible();
  });

  test('reflows at 320 CSS px without horizontal scrolling', async ({ page }) => {
    // WCAG 2.2 AA, SC 1.4.10. The support-size row is three controls side by side, which is
    // what pushes this page over the budget if it is ever pinned to one line.
    await page.setViewportSize({ width: 320, height: 640 });
    await openIntake(page);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(overflows).toBe(false);
  });

  test('the intake form has no accessibility violations', {
    annotation: [{ type: 'category', description: 'a11y' }],
  }, async ({ page }) => {
    await openIntake(page);
    await page.reload();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('the error state has no accessibility violations', {
    annotation: [{ type: 'category', description: 'a11y' }],
  }, async ({ page }) => {
    // The error surface is the part of this page that is easiest to get wrong and hardest to
    // notice: it only exists after a failed submit, so a clean audit of the empty form says
    // nothing about it.
    await openIntake(page);
    await submit(page);
    await expect(errorSummary(page)).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('the project page has no accessibility violations', {
    annotation: [{ type: 'category', description: 'a11y' }],
  }, async ({ page }) => {
    await openIntake(page);
    await stubUpload(page, 201, created());
    await fillIntake(page);
    await submit(page);
    await expect(page).toHaveURL(new RegExp(`/en/projects/${PROJECT_ID}$`));

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

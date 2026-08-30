import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { entryMessages, GATE_INFO_LINK_TEXT } from './page.fixtures';

vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => entryMessages[key] ?? key),
}));

vi.mock('next-intl', () => {
  const translate = (key: string) => entryMessages[key] ?? key;
  // `rich` runs the <info> chunk through the callback the component supplies, so
  // the About link is exercised rather than stubbed away.
  // Returned as a fragment, not an array: an array of mixed strings and elements
  // cannot carry keys, and the resulting warning is indistinguishable from a real
  // missing-key bug in the component under test.
  translate.rich = (key: string, tags: Record<string, (chunks: string) => unknown>) =>
    key === 'gate.label' ? (
      <>I understand this is a demonstration. {tags.info(GATE_INFO_LINK_TEXT)}</>
    ) : (
      key
    );
  return { useTranslations: () => translate };
});

// The server action is a 'use server' module — its own path (cookie, redirect) is
// covered by actions' unit test and by the entry point's Playwright run.
const acknowledgeAndLaunch = vi.fn();
vi.mock('@/app/[locale]/actions', () => ({
  acknowledgeAndLaunch: (formData: FormData) => acknowledgeAndLaunch(formData),
}));

vi.mock('@/env', () => ({
  env: {
    NEXT_PUBLIC_STUDIO_URL: undefined,
    NEXT_PUBLIC_OPERATIONS_URL: undefined,
  },
}));

// The page reads the acknowledgement cookie to decide the checkbox's initial state.
// Hoisted so the `vi.mock` factory below — which is itself hoisted above the imports —
// can close over it and each test can set the answer.
const ackCookieSet = vi.hoisted(() => ({ value: false }));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ has: () => ackCookieSet.value }),
}));

import EntryPage from './page';

const renderPage = async (
  searchParams: { next?: string } = {},
  { acknowledged = false }: { acknowledged?: boolean } = {},
) => {
  ackCookieSet.value = acknowledged;
  return render(await EntryPage({ searchParams: Promise.resolve(searchParams) }));
};

/** base-ui updates state asynchronously after a click; `act` flushes it. */
const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

// @trace flow=platform.shell category=functionality
describe('Entry landing page', () => {
  it('renders the headline and supporting copy', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Two surfaces, one studio');
  });

  // The header renders the mark beside the wordmark, so the page's display copy must
  // not be announced either — two "Art Loupe" readings for one brand.
  it('renders the logo decoratively', async () => {
    const { container } = await renderPage();

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(1);
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = await renderPage();

    expect(await axe(container)).toHaveNoViolations();
  });
});

// @trace flow=platform.shell category=functionality
describe('launch panels', () => {
  it('renders both surfaces with their own headings', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { level: 2, name: 'Artist Studio' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Operations Control' }),
    ).toBeInTheDocument();
  });

  /**
   * A screenshot cannot tell a scoped panel from a plain card, and the
   * class is the entire mechanism by which a panel renders its app's palette — so it
   * is asserted here, and the values behind it are pinned in fascia's contrast suite.
   */
  it('scopes the operations panel to its app palette', async () => {
    const { container } = await renderPage();

    expect(container.querySelector('.theme-operations')).not.toBeNull();
  });

  // Entry's ambient tokens already are the studio skin; a `.theme-studio` class
  // would mean those values had acquired a second home.
  it('leaves the studio panel on the ambient skin', async () => {
    const { container } = await renderPage();

    expect(container.querySelector('.theme-studio')).toBeNull();
  });

  it('badges only Operations as authorized-access', async () => {
    await renderPage();

    expect(screen.getAllByText('Authorized access only')).toHaveLength(1);
  });

  it('keeps the launch buttons enabled while unacknowledged', async () => {
    await renderPage();

    const buttons = screen.getAllByRole('button', { name: /Launch App|Go to Login/ });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toBeEnabled();
    }
  });
});

// @trace flow=platform.shell category=functionality
describe('the acknowledgement gate', () => {
  it('shows no error before the user acts', async () => {
    await renderPage();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toHaveAttribute('aria-invalid');
  });

  it('blocks launch, announces, and moves focus when unacknowledged', async () => {
    await renderPage();

    await click(screen.getAllByRole('button', { name: 'Launch App' })[0]);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'Please acknowledge the synthetic-data notice before launching an app.',
    );

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toHaveAttribute('aria-invalid', 'true');
    expect(checkbox).toHaveAttribute('aria-describedby', alert.id);
    expect(checkbox).toHaveFocus();
    expect(acknowledgeAndLaunch).not.toHaveBeenCalled();
  });

  it('clears the error once the box is ticked', async () => {
    await renderPage();

    await click(screen.getAllByRole('button', { name: 'Launch App' })[0]);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await click(screen.getByRole('checkbox'));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toHaveAttribute('aria-invalid');
  });

  it('posts the acknowledgement once the box is ticked', async () => {
    const { container } = await renderPage();

    await click(screen.getByRole('checkbox'));

    expect(container.querySelector('input[name="acknowledged"]')).toHaveValue('on');
  });

  // The cookie is httpOnly, so only the server can see it — a visitor who has already
  // acknowledged in this session should not be asked to tick the box again on every
  // return to the entry point.
  it('pre-ticks the box when the acknowledgement cookie is already set', async () => {
    const { container } = await renderPage({}, { acknowledged: true });

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(container.querySelector('input[name="acknowledged"]')).toHaveValue('on');
  });

  it('leaves the box unticked when the cookie is absent', async () => {
    const { container } = await renderPage();

    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(container.querySelector('input[name="acknowledged"]')).toHaveValue('');
  });

  it('links the notice into the About site synthetic-data section', async () => {
    await renderPage();

    expect(screen.getByRole('link', { name: GATE_INFO_LINK_TEXT })).toHaveAttribute(
      'href',
      '/about#synthetic-data',
    );
  });
});

// @trace flow=platform.shell category=functionality
describe('the next= handoff', () => {
  it('forwards an allowed resume URL as a hidden field', async () => {
    const { container } = await renderPage({ next: 'http://localhost:3001/en/home' });

    expect(container.querySelector('input[name="next"]')).toHaveValue(
      'http://localhost:3001/en/home',
    );
  });

  // The allowlist itself is covered in app-origins.test.ts; this asserts the page
  // never hands a rejected value to the browser at all.
  it('drops an off-origin resume URL rather than rendering it', async () => {
    const { container } = await renderPage({ next: 'https://evil.test/steal' });

    expect(container.querySelector('input[name="next"]')).toBeNull();
  });
});

import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import messages from '../../messages/en.json';

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: Omit<ComponentProps<'a'>, 'href'> & { href: { query: { window: string } } }) => (
    <a href={`/home?window=${href.query.window}`} {...rest}>
      {children}
    </a>
  ),
}));

import { WindowNav } from './window-nav';

const renderNav = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WindowNav current="7d" />
    </NextIntlClientProvider>,
  );

// @trace flow=ops.observability category=functionality
describe('WindowNav', () => {
  it('marks the current window and links the others', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'Time window' });
    expect(within(nav).getByRole('link', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Last 30 days' })).toHaveAttribute(
      'href',
      '/home?window=30d',
    );
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = renderNav();
    expect(await axe(container)).toHaveNoViolations();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { StandaloneMessage } from './standalone-message';

const labels = {
  orgName: 'Art Loupe',
  title: "We couldn't find that page",
  message: 'The link may be out of date.',
  actionLabel: 'Go to Art Loupe',
};

// @trace flow=platform.shell category=functionality
describe('StandaloneMessage', () => {
  it('renders the message as the page h1 with a way out', () => {
    render(<StandaloneMessage labels={labels} actionHref="http://localhost:3003" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(labels.title);
    expect(screen.getByText(labels.message)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: labels.actionLabel })).toHaveAttribute(
      'href',
      'http://localhost:3003',
    );
  });

  /**
   * This renders where `NextIntlClientProvider`, `ThemeProvider` and the router are all
   * absent — `global-not-found` bypasses every layout. A provider-backed primitive here
   * throws at render, which would turn the page that exists to survive a failure into a
   * second failure. So: plain `<a>`, plain strings, no hooks.
   */
  it('uses a plain anchor rather than a router-bound link', () => {
    render(<StandaloneMessage labels={labels} actionHref="http://localhost:3003" />);

    const action = screen.getByRole('link', { name: labels.actionLabel });
    expect(action.tagName).toBe('A');
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = render(
      <StandaloneMessage labels={labels} actionHref="http://localhost:3003" />,
    );

    const results = await axe(container);
    expect(results.violations).toEqual([]);
    // axe reports an unresolvable text background as `incomplete`, not a violation,
    // so a green `violations` array alone would not prove the contrast was checked.
    expect(results.incomplete.filter((check) => check.id === 'color-contrast')).toEqual([]);
  });
});

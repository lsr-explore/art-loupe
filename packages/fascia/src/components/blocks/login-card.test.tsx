import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { LoginCard } from './login-card';

const baseProps = {
  title: 'Your recovery companion',
  description: 'Sign in to check symptoms and review your recovery plan.',
  children: <button type="submit">Sign in</button>,
};

// @trace flow=platform.auth category=functionality
describe('LoginCard', () => {
  it('renders the title as the page h1', () => {
    render(<LoginCard {...baseProps} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your recovery companion');
  });

  it('renders the description and the form slot', () => {
    render(<LoginCard {...baseProps} />);

    expect(screen.getByText(baseProps.description)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('omits the description paragraph when none is given', () => {
    render(<LoginCard title={baseProps.title}>{baseProps.children}</LoginCard>);

    expect(screen.queryByText(baseProps.description)).not.toBeInTheDocument();
  });

  it('paints the backdrop behind the card, not inside it', () => {
    const { container } = render(
      <LoginCard {...baseProps} backdrop={<div data-testid="backdrop" />} />,
    );

    const backdrop = screen.getByTestId('backdrop');
    const card = container.querySelector('[data-slot="card"]');
    expect(card).not.toBeNull();
    // A later positioned sibling stacks above without a z-index — if the backdrop
    // ever moved after the card it would cover the form.
    expect(card).not.toContainElement(backdrop);
    expect(backdrop.compareDocumentPosition(card as Element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('keeps the card surface solid so no text sits on the backdrop', () => {
    const { container } = render(<LoginCard {...baseProps} />);

    // The card is over the photo's horizon band. `bg-card` with no alpha is
    // what keeps every string on a pairing the contrast gate can measure.
    const card = container.querySelector('[data-slot="card"]');
    expect(card).toHaveClass('bg-card');
    expect(card?.className).not.toMatch(/bg-card\//);
  });

  it('renders the org lockup above the card, not inside it', () => {
    const { container } = render(
      <LoginCard {...baseProps} orgName="Art Loupe" appName="Artist Studio" />,
    );

    const org = screen.getByText('Art Loupe');
    const card = container.querySelector('[data-slot="card"]');
    expect(card).not.toContainElement(org);
  });

  // The app name is what distinguishes the three surfaces, so it has to be in the
  // outline — "Log In" alone would give all three the same page title.
  it('prefixes the app name to the single h1', () => {
    render(<LoginCard {...baseProps} orgName="Art Loupe" appName="Artist Studio" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      `Artist Studio - ${baseProps.title}`,
    );
  });

  // Without the guard, a card given no app name opens on a stray "- ".
  it('omits the separator when no app name is given', () => {
    render(<LoginCard {...baseProps} orgName="Art Loupe" />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(baseProps.title);
  });

  // The org name is the identity the header already carries — one label, one outline.
  it('keeps the organisation name out of the heading outline', () => {
    render(<LoginCard {...baseProps} orgName="Art Loupe" appName="Artist Studio" />);

    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByText('Art Loupe').tagName).toBe('SPAN');
  });

  // The wordmark stacks over two lines to match the artwork, but a screen reader must
  // still be handed the name whole — two block children leave the computed name to
  // implementation-specific whitespace handling, i.e. "ArtLoupe".
  it('stacks the wordmark visually while keeping the accessible name intact', () => {
    render(<LoginCard {...baseProps} orgName="Art Loupe" appName="Artist Studio" />);

    const visualLines = screen.getAllByText(/^(Art|Loupe)$/);
    expect(visualLines).toHaveLength(2);
    for (const line of visualLines) {
      expect(line).toHaveAttribute('aria-hidden', 'true');
    }

    expect(screen.getByText('Art Loupe')).toHaveClass('sr-only');
  });

  it('renders a single-word org name on one line', () => {
    render(<LoginCard {...baseProps} orgName="Loupe" appName="Artist Studio" />);

    expect(screen.getAllByText('Loupe')).toHaveLength(2); // the visual line and the sr-only name
  });

  it('omits the lockup entirely when no org name is given', () => {
    render(<LoginCard {...baseProps} />);

    expect(screen.queryByText(/Art Loupe/)).not.toBeInTheDocument();
  });

  it('applies an extra className to the root', () => {
    const { container } = render(<LoginCard {...baseProps} className="test-class" />);

    expect(container.firstElementChild).toHaveClass('test-class');
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = render(<LoginCard {...baseProps} />);

    const results = await axe(container);

    expect(results).toHaveNoViolations();
  });
});

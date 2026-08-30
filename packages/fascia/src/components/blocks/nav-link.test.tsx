import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { NavLink } from './nav-link';

const Link = ({ href, className, children, ...rest }: ComponentProps<'a'>) => (
  <a href={href} className={className} {...rest}>
    {children}
  </a>
);

const renderLink = (props: Partial<ComponentProps<typeof NavLink>> = {}) => {
  render(
    <NavLink href="/board" linkComponent={Link} isActive={false} {...props}>
      Critique Queue
    </NavLink>,
  );
  return screen.getByRole('link', { name: 'Critique Queue' });
};

// @trace flow=platform.shell category=functionality
describe('NavLink', () => {
  it('marks the current page for assistive tech', () => {
    expect(renderLink({ isActive: true })).toHaveAttribute('aria-current', 'page');
  });

  it('sets aria-current only on the active link', () => {
    expect(renderLink()).not.toHaveAttribute('aria-current');
  });

  /**
   * The two variants draw from **different token families**, which is the point of the
   * prop — `--sidebar-accent` is deliberately tinted where `--muted` is near-neutral.
   * Collapsing them is what left the `--sidebar-*` contrast assertions with nothing
   * rendering them, and it is invisible in a screenshot because `--sidebar` and `--card`
   * currently hold the same value. These assertions are the guard.
   */
  it('draws the sidebar variant from the sidebar token family', () => {
    const link = renderLink({ variant: 'sidebar', isActive: true });

    expect(link.className).toContain('bg-sidebar-primary');
    expect(link.className).toContain('text-sidebar-primary-foreground');
    expect(link.className).toContain('outline-sidebar-ring');
  });

  it('tints the sidebar hover state rather than greying it', () => {
    const link = renderLink({ variant: 'sidebar' });

    expect(link.className).toContain('hover:bg-sidebar-accent');
    expect(link.className).toContain('text-sidebar-foreground');
    expect(link.className).not.toContain('bg-muted');
  });

  it('keeps the inline variant on the page muted family', () => {
    const link = renderLink({ isActive: true });

    expect(link.className).toContain('bg-muted');
    expect(link.className).not.toContain('sidebar');
  });
});

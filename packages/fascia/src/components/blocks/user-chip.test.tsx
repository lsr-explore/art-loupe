import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { UserChip } from './user-chip';

const baseProps = {
  username: 'demo.artist@demo.artloupestudio.com',
  signedInAsLabel: 'Signed in as',
  signOutLabel: 'Sign out',
  signOutAction: () => {},
};

// @trace flow=platform.shell category=functionality
describe('UserChip', () => {
  it('renders the signed-in username', () => {
    render(<UserChip {...baseProps} />);

    expect(screen.getByText('demo.artist@demo.artloupestudio.com')).toBeInTheDocument();
  });

  it('prefixes the username with an assistive-tech-only "signed in as"', () => {
    render(<UserChip {...baseProps} />);

    // Sighted users read the chip from context; screen-reader users need the
    // relationship spelled out, so the prefix is rendered but visually hidden.
    expect(screen.getByText('Signed in as')).toBeInTheDocument();
  });

  it('renders sign-out as a submit button inside a form', () => {
    const { container } = render(<UserChip {...baseProps} />);

    const button = screen.getByRole('button', { name: 'Sign out' });
    expect(button).toHaveAttribute('type', 'submit');
    // A real form (not an onClick handler) is what lets sign-out work before hydration.
    expect(container.querySelector('form')).toContainElement(button);
  });

  it('invokes the supplied action when signed out', () => {
    const signOutAction = vi.fn();
    const { container } = render(<UserChip {...baseProps} signOutAction={signOutAction} />);

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    expect(signOutAction).toHaveBeenCalledTimes(1);
  });

  it('applies an extra className to the root', () => {
    const { container } = render(<UserChip {...baseProps} className="test-class" />);

    expect(container.firstElementChild).toHaveClass('test-class');
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = render(<UserChip {...baseProps} />);

    const results = await axe(container);

    expect(results).toHaveNoViolations();
  });
});

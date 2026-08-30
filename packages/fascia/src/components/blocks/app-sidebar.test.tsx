import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { AppSidebar } from './app-sidebar';

const labels = {
  sidebarLabel: 'Sections',
  openSidebar: 'Open sections menu',
  closeSidebar: 'Close sections menu',
};

const renderSidebar = () =>
  render(
    <AppSidebar labels={labels}>
      <a href="/home">Dashboard</a>
      <a href="/critique">Critique Queue</a>
    </AppSidebar>,
  );

/**
 * base-ui settles the backdrop and popup transition state in a microtask after the
 * click, so the bare `fireEvent` leaves an un-acted update behind. `act` around the
 * click flushes it — the alternative is a wall of act() warnings that hides a real
 * one when it appears.
 */
const openOverlay = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Open sections menu/ }));
  });
  return screen.findByRole('dialog');
};

const closeOverlay = async (run: () => void) => {
  await act(async () => {
    run();
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
};

// @trace flow=platform.shell category=functionality
describe('AppSidebar', () => {
  it('names the persistent rail as a navigation landmark', () => {
    renderSidebar();

    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('keeps the overlay closed until the trigger is used', () => {
    renderSidebar();

    expect(screen.getByRole('button', { name: /Open sections menu/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a dialog carrying the same links', async () => {
    renderSidebar();

    const dialog = await openOverlay();

    // Named by its own title, so AT announces what the overlay is.
    expect(dialog).toHaveAccessibleName('Sections');
    expect(within(dialog).getByRole('link', { name: 'Critique Queue' })).toBeInTheDocument();
  });

  it('closes on Escape — a menu covering the page must be dismissible', async () => {
    renderSidebar();

    const dialog = await openOverlay();

    await closeOverlay(() => fireEvent.keyDown(dialog, { key: 'Escape' }));
  });

  it('closes from its own close control', async () => {
    renderSidebar();

    const dialog = await openOverlay();

    await closeOverlay(() =>
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close sections menu' })),
    );
  });

  /**
   * An App Router layout survives client-side navigation without remounting, so
   * without this the drawer stays open on top of the page the user just reached.
   * The e2e counterpart in the studio app's sidebar spec proves it against a
   * real router; this pins the mechanism.
   */
  it('closes when a link inside it is activated', async () => {
    renderSidebar();

    const dialog = await openOverlay();

    await closeOverlay(() =>
      fireEvent.click(within(dialog).getByRole('link', { name: 'Critique Queue' })),
    );
  });

  it('stays open when a non-link part of the drawer is clicked', async () => {
    renderSidebar();

    const dialog = await openOverlay();
    fireEvent.click(within(dialog).getByText('Sections'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // @trace category=a11y
  it('has no accessibility violations with the overlay open', async () => {
    const { container } = renderSidebar();

    await openOverlay();

    expect(await axe(container)).toHaveNoViolations();
  });
});

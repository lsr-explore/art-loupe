import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

const Example = ({ labelled = true }: { labelled?: boolean }) => (
  <Table regionLabelledBy={labelled ? 'caption' : undefined}>
    <TableCaption id="caption">Spend by model</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead>Model</TableHead>
        <TableHead>Cost</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableHead scope="row">claude-opus-5</TableHead>
        <TableCell>$0.03</TableCell>
      </TableRow>
    </TableBody>
    <TableFooter>
      <TableRow>
        <TableHead scope="row">Total</TableHead>
        <TableCell>$0.03</TableCell>
      </TableRow>
    </TableFooter>
  </Table>
);

// @trace flow=platform.shell category=functionality
describe('Table', () => {
  it('renders a real table named by its caption', () => {
    render(<Example />);
    expect(screen.getByRole('table', { name: 'Spend by model' })).toBeInTheDocument();
  });

  it('scopes header cells to their column unless told otherwise', () => {
    render(<Example />);
    expect(screen.getByRole('columnheader', { name: 'Model' })).toHaveAttribute('scope', 'col');
    expect(screen.getByRole('rowheader', { name: 'claude-opus-5' })).toHaveAttribute(
      'scope',
      'row',
    );
  });

  // @trace category=a11y
  it('makes the scroll container a focusable, named region when labelled', () => {
    render(<Example />);
    const region = screen.getByRole('region', { name: 'Spend by model' });
    expect(region).toHaveAttribute('tabindex', '0');
  });

  // @trace category=a11y
  it('adds no region or tab stop when unlabelled', () => {
    render(<Example labelled={false} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  // @trace category=a11y
  it('has no accessibility violations', async () => {
    const { container } = render(<Example />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

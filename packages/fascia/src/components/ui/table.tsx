import { cn } from '@artloupe/fascia/lib/utils';
import type * as React from 'react';

type TableProps = React.ComponentProps<'table'> & {
  /**
   * The id of the element that names the table, usually its `TableCaption`. When given, the
   * horizontal scroll container becomes a focusable, named region, so a keyboard user can
   * scroll a table wider than the viewport (WCAG 2.1.1).
   */
  regionLabelledBy?: string;
};

const Table = ({ className, regionLabelledBy, ...props }: TableProps) => (
  <div
    data-slot="table-container"
    className="relative w-full overflow-x-auto rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    {...(regionLabelledBy
      ? { role: 'region', tabIndex: 0, 'aria-labelledby': regionLabelledBy }
      : {})}
  >
    <table
      data-slot="table"
      className={cn('w-full caption-top border-collapse text-sm', className)}
      {...props}
    />
  </div>
);

const TableCaption = ({ className, ...props }: React.ComponentProps<'caption'>) => (
  <caption
    data-slot="table-caption"
    className={cn('mb-2 text-left font-heading text-base font-medium', className)}
    {...props}
  />
);

const TableHeader = ({ className, ...props }: React.ComponentProps<'thead'>) => (
  <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />
);

const TableBody = ({ className, ...props }: React.ComponentProps<'tbody'>) => (
  <tbody
    data-slot="table-body"
    className={cn('[&_tr:last-child]:border-0', className)}
    {...props}
  />
);

const TableFooter = ({ className, ...props }: React.ComponentProps<'tfoot'>) => (
  <tfoot
    data-slot="table-footer"
    className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
    {...props}
  />
);

const TableRow = ({ className, ...props }: React.ComponentProps<'tr'>) => (
  <tr data-slot="table-row" className={cn('border-b', className)} {...props} />
);

/** A header cell. Column scope by default; pass `scope="row"` for a row header. */
const TableHead = ({ className, scope = 'col', ...props }: React.ComponentProps<'th'>) => (
  <th
    data-slot="table-head"
    scope={scope}
    className={cn(
      'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground',
      className,
    )}
    {...props}
  />
);

const TableCell = ({ className, ...props }: React.ComponentProps<'td'>) => (
  <td data-slot="table-cell" className={cn('p-2 align-middle', className)} {...props} />
);

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };

'use client';

import { Button } from '@artloupe/fascia/components/ui/button';
import { Printer } from 'lucide-react';

interface PrintButtonProps {
  /** Visible label — "Download PDF" on a printable document. */
  label: string;
  className?: string;
}

/**
 * Drives the browser's own print path.
 *
 * "Download PDF" rather than "Print" because that is the outcome the reader wants and the
 * one every desktop print dialog offers as *Save as PDF* — the mechanism is print, the
 * artifact is a PDF. It is the only honest label for a button that opens a print dialog.
 *
 * The one genuinely client-side piece of a printable document: everything around it
 * renders on the server. Guarded on `window` so a pre-hydration click cannot throw, and
 * `type="button"` so it never submits a surrounding form.
 */
export const PrintButton = ({ label, className }: PrintButtonProps) => (
  <Button
    type="button"
    variant="outline"
    className={className}
    onClick={() => {
      if (typeof window !== 'undefined') {
        window.print();
      }
    }}
  >
    <Printer aria-hidden="true" />
    {label}
  </Button>
);

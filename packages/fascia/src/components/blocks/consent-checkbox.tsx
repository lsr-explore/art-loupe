'use client';

import { Checkbox } from '@artloupe/fascia/components/ui/checkbox';
import { cn } from '@artloupe/fascia/lib/utils';
import { Field } from '@base-ui/react/field';
import { type ReactNode, type Ref, useId } from 'react';

interface ConsentCheckboxProps {
  /** The consent statement shown beside the checkbox. */
  label: ReactNode;
  /** Controlled checked state — the consuming page owns it. */
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  className?: string;
  /**
   * Marks the control invalid. The underlying `Checkbox` already carries the
   * `aria-invalid:` styling, so this both announces and shows the error state.
   */
  invalid?: boolean;
  /** Id of the element describing the error — pair with `invalid`. */
  describedBy?: string;
  /**
   * Forwarded to the focusable `role="checkbox"` element, so a page that
   * validates on submit can move focus to the control it rejected.
   */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A labelled consent checkbox. Controlled (the page owns `checked`) and
 * presentational — no copy, no gating logic.
 *
 * base-ui `Field` wires the label's `for` to the hidden native input (so a label
 * click toggles), but the exposed `role="checkbox"` element is the styled span —
 * which gets no accessible name from that. We point `aria-labelledby` at the
 * label so the toggle field is named in every engine (WebKit doesn't infer a name
 * from a `<label for>` on a non-native control; Chromium does).
 *
 * `invalid` / `describedBy` / `ref` exist for the entry point's acknowledgement
 * gate, where the launch buttons stay enabled and clicking
 * one unacknowledged has to announce the error and move focus here. They are
 * optional: a consumer that merely gates a submit button needs none of them.
 */
const ConsentCheckbox = ({
  label,
  checked,
  onCheckedChange,
  id,
  className,
  invalid,
  describedBy,
  ref,
}: ConsentCheckboxProps) => {
  const reactId = useId();
  const labelId = `${id ?? reactId}-consent-label`;

  return (
    <Field.Root className={cn('flex items-start gap-2.5', className)}>
      <Checkbox
        ref={ref}
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-labelledby={labelId}
        // Omitted rather than set false: `aria-invalid="false"` is valid but noisy,
        // and `aria-describedby` pointing at an unrendered banner is a dangling ref.
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedBy : undefined}
        className="mt-0.5"
      />
      <Field.Label
        id={labelId}
        className="text-sm leading-snug font-normal text-muted-foreground select-none"
      >
        {label}
      </Field.Label>
    </Field.Root>
  );
};

export { ConsentCheckbox };

'use client';

/**
 * The reference-photograph field: a drop target with a preview, over a real file input.
 *
 * **The file input is still the field.** It is visually hidden but stays in the tab order, keeps
 * the form's label, and is what a keyboard or screen-reader user operates — dragging is a
 * pointer-only gesture, so the drop target is an addition over the input and never a
 * replacement for it (WCAG 2.2, 2.5.7). The whole target is a `<label>` for that input, so a
 * click anywhere in it opens the same picker the input would.
 *
 * **This component checks nothing.** A dropped file and a picked file arrive at the same
 * `onFileChange`, and the form validates whichever one it holds exactly as it always has. The
 * declared type is not consulted, for the reason `intake-form.tsx` gives: the server sniffs the
 * bytes, and a browser's `File.type` is a claim.
 *
 * **The preview is the photograph, unaltered.** It is the artist's own file shown from a local
 * object URL — nothing is uploaded to draw it, and nothing is resized, cropped or re-encoded. A
 * file the browser cannot draw (a HEIC, or something that is not an image at all) loses the
 * thumbnail and keeps its name; whether it is acceptable is the server's call, not the preview's.
 */

import { cn } from '@artloupe/fascia/lib/utils';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from 'react';

interface PhotographDropZoneProps {
  /** The input's id — the form's label, its error links and `aria-describedby` all point here. */
  id: string;
  /** The multipart field name. */
  name: string;
  /** The id of the visible field label, so the input's name is that label and nothing else. */
  labelledBy: string;
  /** The `accept` hint for the picker. A hint, never a check. */
  accept: string;
  describedBy: string;
  invalid: boolean;
  file: File | null;
  onFileChange: (file: File | null) => void;
}

/** Bytes as a short size the artist recognises — the hint states the limit in MB. */
const megabytes = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

/** Only a drag that carries files is a drop candidate; dragged text or a link is not. */
const carriesFiles = (event: DragEvent<HTMLElement>): boolean =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');

export const PhotographDropZone = ({
  id,
  name,
  labelledBy,
  accept,
  describedBy,
  invalid,
  file,
  onFileChange,
}: PhotographDropZoneProps) => {
  const ti = useTranslations('intake');
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; failed: boolean } | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // One object URL per chosen file. It is made when the file is chosen and revoked when it is
  // replaced or the form goes away, so a series of replaced photographs does not pin each one in
  // memory. Made in the handler rather than in an effect keyed on `file`: an effect would have to
  // set state from its body, and React's development double-mount would revoke a URL in use.
  useEffect(
    () => () => {
      if (previewUrlRef.current !== null) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    },
    [],
  );

  const select = (next: File | null) => {
    if (previewUrlRef.current !== null) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    const url = next === null ? null : URL.createObjectURL(next);
    previewUrlRef.current = url;
    setPreview(url === null ? null : { url, failed: false });
    onFileChange(next);
  };

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    select(event.target.files?.[0] ?? null);
  };

  const dragOver = (event: DragEvent<HTMLLabelElement>) => {
    if (!carriesFiles(event)) {
      return;
    }
    // Without this the browser treats the drop as a navigation and opens the file in the tab.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };

  const dragLeave = (event: DragEvent<HTMLLabelElement>) => {
    // `dragleave` also fires when the pointer crosses into a child of the target; only leaving
    // the target itself ends the drag-over state, or the highlight flickers over the preview.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  };

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped === undefined) {
      return;
    }
    // The drop is taken first. Everything after this is optional, and must not be able to lose it.
    select(dropped);

    // Mirror the drop into the input where the browser allows it, so the input never holds a
    // stale pick that a later re-pick of the same file would fail to replace (no `change`).
    // jsdom has no `DataTransfer`; the form reads `file`, so the drop works without the mirror.
    const input = event.currentTarget.querySelector('input[type="file"]');
    if (input instanceof HTMLInputElement && typeof DataTransfer === 'function') {
      try {
        const transfer = new DataTransfer();
        transfer.items.add(dropped);
        input.files = transfer.files;
      } catch {
        // A browser that refuses the assignment keeps the stale pick; the form still holds the drop.
      }
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        onDragEnter={dragOver}
        onDragOver={dragOver}
        onDragLeave={dragLeave}
        onDrop={drop}
        data-dragging={dragging || undefined}
        className={cn(
          'relative flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-input p-6 text-center transition-colors',
          'hover:border-ring hover:bg-accent/40',
          'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
          dragging && 'border-ring bg-accent/60',
          invalid && 'border-destructive',
        )}
      >
        <input
          id={id}
          name={name}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={choose}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
        {preview !== null && !preview.failed ? (
          // A plain <img>: the source is a local blob URL, which `next/image` cannot optimise.
          /* eslint-disable @next/next/no-img-element -- a blob: URL has nothing to optimise */
          // biome-ignore lint/performance/noImgElement: a blob: URL has nothing to optimise
          <img
            src={preview.url}
            alt={ti('dropZone.previewAlt')}
            onError={() => setPreview({ url: preview.url, failed: true })}
            className="max-h-64 max-w-full rounded-md object-contain"
          />
        ) : /* eslint-enable @next/next/no-img-element */ null}
        <span className="text-sm font-medium">
          {file === null ? ti('dropZone.prompt') : ti('dropZone.replacePrompt')}
        </span>
        <span aria-hidden="true" className="text-sm text-muted-foreground">
          {dragging ? ti('dropZone.release') : ti('dropZone.browse')}
        </span>
      </label>
      {/* Rendered empty from the start so the live region exists before it has anything to say —
          a region inserted with its content already in it is not reliably announced. */}
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {file !== null
          ? ti('dropZone.chosen', { name: file.name, sizeMb: megabytes(file.size) })
          : ''}
      </p>
    </div>
  );
};

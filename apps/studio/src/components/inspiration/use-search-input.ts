'use client';
import { useEffect, useState } from 'react';

export const SEARCH_DEBOUNCE_MS = 600;
const alwaysCommit = () => true;

interface SearchInputOptions<T> {
  /** Whether a typed draft is worth an automatic request. Submit ignores this.
   * Pass a stable (module-level) function: a new one each render restarts the timer. */
  shouldAutoCommit?: (draft: T) => boolean;
  delay?: number;
}

/** Immediate draft, delayed request. Cleanup prevents a previous keystroke winning.
 * Submit commits immediately; typing waits, and only commits drafts the caller judges
 * worth a request, because every automatic request can spend shared provider quota.
 * React Query aborts obsolete fetches.
 */
export const useSearchInput = <T>(
  initial: T,
  { shouldAutoCommit = alwaysCommit, delay = SEARCH_DEBOUNCE_MS }: SearchInputOptions<T> = {},
) => {
  const [draft, setDraft] = useState(initial);
  const [committed, setCommitted] = useState(initial);
  useEffect(() => {
    if (!shouldAutoCommit(draft)) return;
    const timeout = setTimeout(() => setCommitted(draft), delay);
    return () => clearTimeout(timeout);
  }, [draft, delay, shouldAutoCommit]);
  return {
    draft,
    setDraft,
    committed,
    commit: () => setCommitted(draft),
    replace: (value: T) => {
      setDraft(value);
      setCommitted(value);
    },
  };
};

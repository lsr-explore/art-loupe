'use client';
import { useEffect, useState } from 'react';

/** Immediate draft, delayed request. Cleanup prevents a previous keystroke winning.
 * Submit commits immediately; typing waits 350 ms. React Query aborts obsolete fetches.
 */
export const useSearchInput = <T>(initial: T) => {
  const [draft, setDraft] = useState(initial);
  const [committed, setCommitted] = useState(initial);
  useEffect(() => {
    const timeout = setTimeout(() => setCommitted(draft), 350);
    return () => clearTimeout(timeout);
  }, [draft]);
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

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSearchInput } from './use-search-input';

afterEach(() => vi.useRealTimers());
// @trace flow=inspiration.search category=performance
describe('inspiration.search: debounce', () => {
  it('commits only the final keystroke and submit bypasses the delay', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useSearchInput(''));
    act(() => result.current.setDraft('t'));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.setDraft('trees'));
    act(() => vi.advanceTimersByTime(599));
    expect(result.current.committed).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.committed).toBe('trees');
    act(() => result.current.setDraft('flowers'));
    act(() => result.current.commit());
    expect(result.current.committed).toBe('flowers');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('typing a draft the caller rejects never commits, but submit still does', () => {
    vi.useFakeTimers();
    const longEnough = (value: string) => value.length >= 3;
    const { result } = renderHook(() =>
      useSearchInput<string>('', { shouldAutoCommit: longEnough }),
    );
    act(() => result.current.setDraft('ox'));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.committed).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    act(() => result.current.commit());
    expect(result.current.committed).toBe('ox');
  });
  it('source changes replace both values immediately', () => {
    const { result } = renderHook(() => useSearchInput('pexels'));
    act(() => result.current.replace('met'));
    expect(result.current.committed).toBe('met');
    expect(result.current.draft).toBe('met');
  });
});

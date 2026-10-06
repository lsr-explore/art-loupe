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
    act(() => vi.advanceTimersByTime(349));
    expect(result.current.committed).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.committed).toBe('trees');
    act(() => result.current.setDraft('flowers'));
    act(() => result.current.commit());
    expect(result.current.committed).toBe('flowers');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('source changes replace both values immediately', () => {
    const { result } = renderHook(() => useSearchInput('pexels'));
    act(() => result.current.replace('met'));
    expect(result.current.committed).toBe('met');
    expect(result.current.draft).toBe('met');
  });
});

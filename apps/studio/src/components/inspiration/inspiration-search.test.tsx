import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en.json';
import { InspirationSearch } from './inspiration-search';

const photo = {
  id: 'pexels:1',
  source: 'pexels',
  image_url: 'https://images.pexels.com/a.jpg',
  source_url: 'https://www.pexels.com/photo/1',
  title: 'Trees',
  creator: 'Pat',
  medium: null,
  date: null,
  year: null,
  alt: 'Trees',
};
const response = { items: [photo], page: 1, has_more: false, stale: false, partial: false };
const open = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <InspirationSearch />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Search' }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
// @trace flow=inspiration.search category=functionality
describe('inspiration search', () => {
  it('applies the chosen layout to the result list without a new request', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(response));
    open();
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'trees' } });
    submit();
    const list = await screen.findByRole('list', { name: 'Images' });
    expect(list).toHaveAttribute('data-layout', 'grid');
    fireEvent.change(screen.getByLabelText('Layout'), { target: { value: 'flex' } });
    expect(list).toHaveAttribute('data-layout', 'flex');
    // Masonry asks for natural proportions; it engages once the gallery can measure.
    fireEvent.click(screen.getByLabelText(messages.inspiration.masonry));
    expect(screen.getByRole('img').parentElement).not.toHaveClass('aspect-[4/3]');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('names the artist when only a shortened Met artist is held back', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ ...response, items: [] }),
    );
    open();
    fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'met' } });
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'trees' } });
    const artist = screen.getByLabelText(messages.inspiration.artistSearch);
    fireEvent.change(artist, { target: { value: 'Monet' } });
    submit();
    await screen.findByText('No images shown');
    fireEvent.change(artist, { target: { value: 'Mo' } });
    expect(screen.getByRole('status')).toHaveTextContent(
      'These results are for “trees by Monet”. Press Search to search for “trees by Mo”.',
    );
  });
  it('labels loaded results when a short edit is held back from auto-search', async () => {
    // A fresh Response per call: a body can only be read once.
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(response));
    open();
    const keywords = screen.getByLabelText('Keywords');
    fireEvent.change(keywords, { target: { value: 'trees' } });
    submit();
    await screen.findByText('1 image shown');
    fireEvent.change(keywords, { target: { value: 'tr' } });
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 image shown These results are for “trees”. Press Search to search for “tr”.',
    );
    submit();
    await waitFor(() => expect(String(fetch.mock.lastCall?.[0])).toContain('query=tr&'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^1 image shown$/));
  });
  it('loads metadata, filters locally, and displays only source-specific controls', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(response));
    open();
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'trees' } });
    submit();
    await screen.findByRole('heading', { name: 'Trees' });
    expect(screen.getByText('Pat')).toBeVisible();
    expect(screen.queryByLabelText('Artist name (optional)')).not.toBeInTheDocument();
    const calls = fetch.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Filter loaded results by title or creator'), {
      target: { value: 'flowers' },
    });
    expect(screen.getByText(/No loaded images match/)).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(calls);
    fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'met' } });
    expect(screen.getByLabelText('Artist name (optional)')).toBeVisible();
    expect(screen.queryByLabelText('Orientation')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Trees' })).not.toBeInTheDocument();
  });
  it('cancels an obsolete request and does not let it overwrite current results', async () => {
    let aborted = false;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    open();
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'old' } });
    submit();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fetch.mockResolvedValue(Response.json(response));
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'trees' } });
    submit();
    await screen.findByRole('heading', { name: 'Trees' });
    expect(aborted).toBe(true);
  });
  it('retains existing results when loading another batch fails', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ ...response, has_more: true }));
    open();
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'trees' } });
    submit();
    await screen.findByRole('heading', { name: 'Trees' });
    fetch.mockResolvedValue(new Response(null, { status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: 'Load more images' }));
    await screen.findByText(/collection is temporarily unavailable/);
    expect(screen.getByRole('heading', { name: 'Trees' })).toBeVisible();
  });
  it('announces cached and partial data instead of claiming completeness', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ...response, stale: true, partial: true }),
    );
    open();
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'trees' } });
    submit();
    await screen.findByText(/Showing cached results/);
    expect(screen.getByText(/Some artwork details/)).toBeVisible();
  });
});

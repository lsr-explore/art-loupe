import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type { RunResult } from '@/lib/runs/run-contract';

import messages from '../../../messages/en.json';
import { ArtifactGallery } from './artifact-gallery';

const artifacts: RunResult['artifacts'] = [
  {
    tool: 'grayscale',
    tool_version: 'test',
    parameters: {},
    source_checksum: 'a'.repeat(64),
    duration_ms: 10,
    confidence: null,
    limitations: ['Fixed conversion.'],
  },
];
const gallery = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ArtifactGallery projectId="project" artifacts={artifacts} />
    </NextIntlClientProvider>,
  );

// @trace flow=intake.project-intent category=functionality
describe('reference studies', () => {
  it('offers a private image, full-size view and PNG download with limitations', () => {
    gallery();
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      `/api/projects/project/artifacts/grayscale?version=test&checksum=${'a'.repeat(64)}&attempt=0`,
    );
    expect(screen.getByRole('link', { name: 'Open full size' })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(screen.getByRole('link', { name: 'Download PNG' })).toHaveAttribute(
      'download',
      'grayscale.png',
    );
    expect(screen.getByText('Fixed conversion.')).toBeInTheDocument();
    expect(screen.queryByText(/Tool reliability/)).not.toBeInTheDocument();
  });
  it('provides a working retry after image failure', () => {
    gallery();
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      `/api/projects/project/artifacts/grayscale?version=test&checksum=${'a'.repeat(64)}&attempt=1`,
    );
    fireEvent.load(screen.getByRole('img'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

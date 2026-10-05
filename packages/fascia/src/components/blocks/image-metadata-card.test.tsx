import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { ImageMetadataCard } from './image-metadata-card';

// @trace flow=inspiration.search category=a11y
describe('inspiration.search: image metadata card', () => {
  it('preserves metadata when the image fails', () => {
    render(
      <ImageMetadataCard
        imageUrl="https://images.metmuseum.org/a.jpg"
        title="Sunflowers"
        alt="Sunflowers by Van Gogh"
        unavailableLabel="Image unavailable"
        metadata={[{ label: 'Artist', value: 'Van Gogh' }]}
      />,
    );
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('Image unavailable')).toBeVisible();
    expect(screen.getByText('Van Gogh')).toBeVisible();
  });
  it('has a semantic caption and no axe violations', async () => {
    const { container } = render(
      <ImageMetadataCard
        imageUrl="https://images.metmuseum.org/a.jpg"
        title="Sunflowers"
        alt="Sunflowers"
        unavailableLabel="Image unavailable"
        metadata={[]}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

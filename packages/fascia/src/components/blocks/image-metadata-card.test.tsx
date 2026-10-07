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
  // @trace category=functionality
  it('keeps natural proportions for masonry and a fixed frame otherwise', () => {
    const card = (fit: 'frame' | 'natural') =>
      render(
        <ImageMetadataCard
          imageUrl="https://images.metmuseum.org/a.jpg"
          title="Sunflowers"
          alt="Sunflowers"
          unavailableLabel="Image unavailable"
          metadata={[]}
          fit={fit}
        />,
      );
    const framed = card('frame');
    expect(screen.getByRole('img').parentElement).toHaveClass('aspect-[4/3]');
    framed.unmount();
    card('natural');
    expect(screen.getByRole('img').parentElement).not.toHaveClass('aspect-[4/3]');
    expect(screen.getByRole('img')).toHaveClass('h-auto');
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

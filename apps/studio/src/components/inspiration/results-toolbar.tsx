'use client';
import type {
  GalleryEngine,
  GalleryLayout,
} from '@artloupe/fascia/components/blocks/gallery-layout';
import { Label } from '@artloupe/fascia/components/ui/label';
import { NativeSelect } from '@artloupe/fascia/components/ui/native-select';
import type { InspirationRequest } from '@artloupe/schemas/inspiration';
import { useTranslations } from 'next-intl';
import type { ResultSort } from '@/lib/inspiration/results';
import { Field, TextInput } from './form-fields';

interface ResultsToolbarProps {
  source: InspirationRequest['source'];
  filter: string;
  onFilterChange: (filter: string) => void;
  sort: ResultSort;
  onSortChange: (sort: ResultSort) => void;
  layout: GalleryLayout;
  onLayoutChange: (layout: GalleryLayout) => void;
}

/** View controls for loaded results. None of them makes a request. */
export const ResultsToolbar = ({
  source,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  layout,
  onLayoutChange,
}: ResultsToolbarProps) => {
  const translate = useTranslations('inspiration');
  const sorts: ResultSort[] =
    source === 'met'
      ? ['provider', 'title', 'creator', 'oldest', 'newest']
      : ['provider', 'title', 'creator'];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field id="inspiration-filter" label={translate('filterLoaded')}>
        <TextInput
          id="inspiration-filter"
          type="search"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
        />
      </Field>
      <Field id="inspiration-sort" label={translate('sortLoaded')}>
        <NativeSelect
          id="inspiration-sort"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as ResultSort)}
        >
          {sorts.map((value) => (
            <option key={value} value={value}>
              {translate(value === 'title' ? 'titleSort' : value)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="inspiration-layout" label={translate('layout')}>
        <NativeSelect
          id="inspiration-layout"
          value={layout.engine}
          onChange={(event) =>
            onLayoutChange({ ...layout, engine: event.target.value as GalleryEngine })
          }
        >
          <option value="grid">{translate('layoutGrid')}</option>
          <option value="flex">{translate('layoutFlex')}</option>
        </NativeSelect>
      </Field>
      <div className="flex min-h-11 items-center gap-3 sm:self-end">
        <input
          className="size-6 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          id="inspiration-masonry"
          type="checkbox"
          checked={layout.masonry}
          onChange={(event) => onLayoutChange({ ...layout, masonry: event.target.checked })}
        />
        <Label htmlFor="inspiration-masonry">{translate('masonry')}</Label>
      </div>
    </div>
  );
};

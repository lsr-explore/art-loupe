'use client';
import { Button } from '@artloupe/fascia/components/ui/button';
import { Label } from '@artloupe/fascia/components/ui/label';
import { NativeSelect } from '@artloupe/fascia/components/ui/native-select';
import { type InspirationRequest, inspirationRequestSchema } from '@artloupe/schemas/inspiration';
import { useTranslations } from 'next-intl';
import { Field, linkClass, TextInput } from './form-fields';

const ORIENTATIONS = ['', 'landscape', 'portrait', 'square'] as const;
const SIZES = ['', 'small', 'medium', 'large'] as const;
const COLORS = [
  '',
  'red',
  'orange',
  'yellow',
  'green',
  'turquoise',
  'blue',
  'violet',
  'pink',
  'brown',
  'black',
  'gray',
  'white',
] as const;

export const datesInvalid = (request: InspirationRequest) =>
  (request.date_begin === null) !== (request.date_end === null) ||
  (request.date_begin !== null &&
    request.date_end !== null &&
    request.date_begin > request.date_end);

interface InspirationSearchFormProps {
  draft: InspirationRequest;
  onChange: <K extends keyof InspirationRequest>(key: K, value: InspirationRequest[K]) => void;
  onSourceChange: (source: InspirationRequest['source']) => void;
  onSubmit: () => void;
}

/** The request form. It edits only the draft; when a search runs is the parent's call. */
export const InspirationSearchForm = ({
  draft,
  onChange,
  onSourceChange,
  onSubmit,
}: InspirationSearchFormProps) => {
  const translate = useTranslations('inspiration');
  const invalidDates = datesInvalid(draft);
  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="inspiration-source" label={translate('source')}>
            <NativeSelect
              id="inspiration-source"
              value={draft.source}
              onChange={(event) =>
                onSourceChange(event.target.value as InspirationRequest['source'])
              }
            >
              <option value="pexels">Pexels</option>
              <option value="met">{translate('met')}</option>
            </NativeSelect>
          </Field>
          <Field id="inspiration-query" label={translate('keywords')}>
            <TextInput
              id="inspiration-query"
              type="search"
              maxLength={150}
              value={draft.query}
              onChange={(event) => onChange('query', event.target.value)}
            />
          </Field>
        </div>
        <fieldset className="rounded-xl border border-foreground p-4">
          <legend className="px-2 font-semibold">{translate('requestFilters')}</legend>
          {draft.source === 'pexels' ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="inspiration-orientation" label={translate('orientation')}>
                <NativeSelect
                  id="inspiration-orientation"
                  value={draft.orientation}
                  onChange={(event) =>
                    onChange('orientation', event.target.value as InspirationRequest['orientation'])
                  }
                >
                  {ORIENTATIONS.map((value) => (
                    <option key={value} value={value}>
                      {translate(value || 'any')}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="inspiration-size" label={translate('size')}>
                <NativeSelect
                  id="inspiration-size"
                  value={draft.size}
                  onChange={(event) =>
                    onChange('size', event.target.value as InspirationRequest['size'])
                  }
                >
                  {SIZES.map((value) => (
                    <option key={value} value={value}>
                      {translate(value || 'any')}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="inspiration-color" label={translate('color')}>
                <NativeSelect
                  id="inspiration-color"
                  value={draft.color}
                  onChange={(event) =>
                    onChange('color', event.target.value as InspirationRequest['color'])
                  }
                >
                  {COLORS.map((value) => (
                    <option key={value} value={value}>
                      {translate(value || 'any')}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="inspiration-artist" label={translate('artistSearch')}>
                <TextInput
                  id="inspiration-artist"
                  maxLength={100}
                  value={draft.artist}
                  onChange={(event) => onChange('artist', event.target.value)}
                />
              </Field>
              <div className="flex min-h-11 items-center gap-3">
                <input
                  className="size-6 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                  id="inspiration-highlights"
                  type="checkbox"
                  checked={draft.highlights}
                  onChange={(event) => onChange('highlights', event.target.checked)}
                />
                <Label htmlFor="inspiration-highlights">{translate('highlights')}</Label>
              </div>
              <Field id="inspiration-date-begin" label={translate('dateBegin')}>
                <TextInput
                  id="inspiration-date-begin"
                  type="number"
                  min={-5000}
                  max={2100}
                  aria-invalid={invalidDates}
                  aria-describedby="inspiration-dates-hint"
                  value={draft.date_begin ?? ''}
                  onChange={(event) =>
                    onChange(
                      'date_begin',
                      event.target.value === '' ? null : Number(event.target.value),
                    )
                  }
                />
              </Field>
              <Field id="inspiration-date-end" label={translate('dateEnd')}>
                <TextInput
                  id="inspiration-date-end"
                  type="number"
                  min={-5000}
                  max={2100}
                  aria-invalid={invalidDates}
                  aria-describedby="inspiration-dates-hint"
                  value={draft.date_end ?? ''}
                  onChange={(event) =>
                    onChange(
                      'date_end',
                      event.target.value === '' ? null : Number(event.target.value),
                    )
                  }
                />
              </Field>
              <p id="inspiration-dates-hint" className="sm:col-span-2">
                {translate('datesHint')}
              </p>
            </div>
          )}
        </fieldset>
        <Button
          className="min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          type="submit"
          disabled={!inspirationRequestSchema.safeParse(draft).success}
        >
          {translate('search')}
        </Button>
      </form>
      {draft.source === 'pexels' ? (
        <a className={linkClass} href="https://www.pexels.com">
          {translate('pexelsCredit')}
        </a>
      ) : null}
    </>
  );
};

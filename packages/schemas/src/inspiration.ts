import { z } from 'zod/v4';

export const inspirationRequestSchema = z
  .object({
    source: z.enum(['pexels', 'met']),
    query: z.string().trim().max(150).default(''),
    artist: z.string().trim().max(100).default(''),
    orientation: z.enum(['', 'landscape', 'portrait', 'square']).default(''),
    size: z.enum(['', 'small', 'medium', 'large']).default(''),
    color: z
      .enum([
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
      ])
      .default(''),
    date_begin: z.number().int().min(-5000).max(2100).nullable().default(null),
    date_end: z.number().int().min(-5000).max(2100).nullable().default(null),
    highlights: z.boolean().default(false),
    page: z.number().int().min(1).max(417).default(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const invalid = !value.query && !(value.source === 'met' && value.artist);
    const wrongSource =
      value.source === 'pexels'
        ? Boolean(
            value.artist ||
            value.highlights ||
            value.date_begin !== null ||
            value.date_end !== null,
          )
        : Boolean(value.orientation || value.size || value.color);
    const dates =
      (value.date_begin === null) !== (value.date_end === null) ||
      (value.date_begin !== null && value.date_end !== null && value.date_begin > value.date_end);
    if (invalid || wrongSource || dates)
      ctx.addIssue({ code: 'custom', message: 'Invalid search filters' });
  });

const providerUrl = (hosts: string[]) =>
  z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      hosts.includes(url.hostname) &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443')
    );
  });
export const inspirationImageSchema = z.object({
  id: z.string(),
  source: z.enum(['pexels', 'met']),
  image_url: providerUrl(['images.pexels.com', 'images.metmuseum.org']),
  source_url: providerUrl(['www.pexels.com', 'pexels.com', 'www.metmuseum.org', 'metmuseum.org']),
  title: z.string(),
  creator: z.string().nullable(),
  medium: z.string().nullable(),
  date: z.string().nullable(),
  year: z.number().int().nullable(),
  alt: z.string(),
});
export const inspirationResponseSchema = z.object({
  items: z.array(inspirationImageSchema).max(24),
  page: z.number().int().min(1).max(417),
  has_more: z.boolean(),
  stale: z.boolean(),
  partial: z.boolean(),
});
export type InspirationRequest = z.infer<typeof inspirationRequestSchema>;
export type InspirationImage = z.infer<typeof inspirationImageSchema>;
export type InspirationResponse = z.infer<typeof inspirationResponseSchema>;

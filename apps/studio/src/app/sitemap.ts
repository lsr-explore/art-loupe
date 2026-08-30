import type { MetadataRoute } from 'next';
import { env } from '@/env';

const baseUrl = env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';

const sitemap = (): MetadataRoute.Sitemap => [
  {
    url: baseUrl,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: 1,
  },
];

export default sitemap;

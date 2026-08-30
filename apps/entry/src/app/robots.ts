import type { MetadataRoute } from 'next';
import { env } from '@/env';

const baseUrl = env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3003';

const robots = (): MetadataRoute.Robots => ({
  rules: {
    userAgent: '*',
    allow: '/',
  },
  sitemap: `${baseUrl}/sitemap.xml`,
});

export default robots;

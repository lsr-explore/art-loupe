import bundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const isDev = process.env.NODE_ENV === 'development';

// HSTS + CSP `upgrade-insecure-requests` are correct for the HTTPS deployment, but
// they break a production build served over plain HTTP on localhost (e.g.
// Playwright's webServer) in strict engines like WebKit — subresource requests get
// upgraded to https://localhost and fail. Opt out for those HTTP-localhost runs.
const enforceHttps = !isDev && process.env.DISABLE_HTTPS_UPGRADE !== 'true';

const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data:;
  font-src 'self';
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  ${enforceHttps ? 'upgrade-insecure-requests;' : ''}
`
  .replace(/\s{2,}/g, ' ')
  .trim();

const securityHeaders = [
  ...(enforceHttps
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Content-Security-Policy', value: cspHeader },
];

const nextConfig: NextConfig = {
  transpilePackages: ['@artloupe/fascia', '@artloupe/auth'],
  serverExternalPackages: ['pino', 'pino-pretty'],
  experimental: {
    // Enables `src/app/global-not-found.tsx`. Required, not cosmetic: the root layout
    // is a top-level dynamic segment (`app/[locale]/layout.tsx` owns `<html>`/`<body>`),
    // so without it every unmatched URL renders Next's "Missing <html> and <body> tags
    // in the root layout" error instead of a 404. Experimental in 16.2 — see the file.
    globalNotFound: true,
  },
  images: {
    // The login backdrop is the LCP element and the only image this app optimizes
    //. Order matters: Next takes the first entry the browser's
    // `Accept` header matches, so AVIF wins where it is supported and WebP catches
    // the rest. Anything matching neither falls back to the source JPEG.
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(withBundleAnalyzer(nextConfig));

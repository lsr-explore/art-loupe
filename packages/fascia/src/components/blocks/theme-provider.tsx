'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

/**
 * App-agnostic wrapper around next-themes. Each app renders this inside its
 * `<body>` with `attribute="class"` so the `.dark` class lands on `<html>`
 * (matching the `@custom-variant dark` in every app's globals.css).
 */
export const ThemeProvider = ({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) => (
  <NextThemesProvider {...props}>{children}</NextThemesProvider>
);

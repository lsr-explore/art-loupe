'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { InspirationSearch } from './inspiration-search';

export const InspirationPage = () => {
  // A client per mounted page, never a server-module singleton shared across users.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 300000,
            gcTime: 1800000,
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <InspirationSearch />
    </QueryClientProvider>
  );
};

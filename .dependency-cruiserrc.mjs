/** @type {import('dependency-cruiser').IConfiguration} */
const config = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies lead to hard-to-debug issues and tight coupling.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-fascia-to-app',
      severity: 'error',
      comment: 'The shared UI library must not depend on app-specific code.',
      from: { path: '^packages/fascia/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-auth-to-app',
      severity: 'error',
      comment: 'The shared auth package must not depend on app-specific code.',
      from: { path: '^packages/auth/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-auth-to-fascia',
      severity: 'error',
      comment: 'Server-side auth and the UI library stay decoupled — no cross-dependency.',
      from: { path: '^packages/auth/' },
      to: { path: '^packages/fascia/' },
    },
    {
      name: 'no-app-to-app',
      severity: 'error',
      comment: 'Apps must not depend on other apps directly — share via packages/.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/(?!$1)([^/]+)/' },
    },
    {
      name: 'no-orphans',
      severity: 'info',
      comment: 'Modules that are not imported by anything may be dead code.',
      from: {
        orphan: true,
        pathNot: [
          '\\.(test|spec|stories)\\.(ts|tsx)$',
          '\\.d\\.ts$',
          '(^|/)index\\.ts$',
          '^apps/[^/]+/src/app/',
          'instrumentation\\.ts$',
          'env\\.ts$',
          'test-setup\\.ts$',
          'reset\\.d\\.ts$',
          'proxy\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};

export default config;

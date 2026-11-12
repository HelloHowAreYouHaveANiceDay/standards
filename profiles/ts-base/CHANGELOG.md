# ts-base

Plain TypeScript (Node CLIs, libraries, Cloudflare Workers): ESLint (flat, type-aware: @eslint/js recommended +
typescript-eslint recommendedTypeChecked via projectService + eslint-comments), Prettier, `tsc --build`, exact tool
pins checked offline. Strictness-only tsconfig base the follower extends with its runtime. Pairs with base.

## 1.0.0

- First release (prior art: typescript-eslint's recommended typed setup, @tsconfig/strictest 2.0.9 and
  @tsconfig/node24 24.0.6 as the follower's runtime base, `wrangler types` for Workers). Pins: eslint 10.14.0,
  typescript 6.0.3 (TS 7 has no API yet for typescript-eslint), typescript-eslint 8.72.2, @eslint/js 10.0.1,
  eslint-config-prettier 10.1.8, @eslint-community/eslint-plugin-eslint-comments 4.8.1, prettier 3.10.0.

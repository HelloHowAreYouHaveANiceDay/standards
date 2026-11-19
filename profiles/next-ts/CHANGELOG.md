# next-ts

Next.js (App or Pages router) + TypeScript: ESLint (flat, eslint-config-next core-web-vitals + typescript-eslint
recommendedTypeChecked + eslint-comments), Prettier, `next typegen` + `tsc --noEmit`, exact tool pins checked
offline. Pairs with base.

## 1.0.0

- First release (prior art: create-next-app 16.4.6 templates, Next 16 ESLint CLI -- no `next lint`). Pins: eslint
  10.14.0, typescript 6.0.3, typescript-eslint 8.72.2, eslint-config-next 16.4.6, eslint-config-prettier 10.1.8,
  @eslint-community/eslint-plugin-eslint-comments 4.8.1, prettier 3.10.0. `next` and `react` stay follower-owned.

## 1.0.1

- `pins` now fails when the installed `next` major differs from the installed `eslint-config-next` major (1.0.0 passed next 15.5 with eslint-config-next 16.4.6). Fixture defect added.

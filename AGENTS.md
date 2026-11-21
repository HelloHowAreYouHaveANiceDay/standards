# Repository instructions

- Use Node.js 20 or newer. Install dependencies with `npm ci` before running checks.
- Run `npm test` for the kit unit suite. `node tests/fixture-sync.mjs` runs synced profile gates with real tools.
- Profile changes belong under `src/profiles/<name>/`; add a changelog heading and release a new version with `node scripts/release.mjs <name> <x.y.z>`. Released profile directories are append-only.

# Fixture plugins

One `<profile>.mjs` per profile; `tests/fixture-sync.mjs` loads every `*.mjs` here. Export `fixture`:

```js
export const fixture = {
  id: 'python-base',
  profiles: ['base@1.0.0', 'python-base@1.0.0'],
  files: { 'pyproject.toml': '...', 'app/main.py': '...' }, // a clean follower
  prepare: (dir, h) => true,  // optional: install tools after sync + commit; return false to skip
  inject: (dir, h) => {       // prove each gate bites: write a defect, check fails naming it, remove it
    const r = h.check();
    h.step(r.code === 1 && /expected text/.test(r.out), 'a <defect> fails <tool> naming <file>', r.out);
  },
};
```

Fixtures run on ubuntu-latest and windows-latest in kit CI, with empty tool caches.

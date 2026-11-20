// Vendored by HelloHowAreYouHaveANiceDay/standards (profile ui-kit); do not edit -- re-run sync.
// The one place WCAG contrast is computed. lint.mjs (UK3) and ui-gen.mjs both call pairResults()/inkResults(), so the
// generated ui.<domain> page can never show a pass that the lint fails.
export function parseColor(raw) {
  const s = String(raw).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (!m) return null;
  const p = m[2].split(/[\s,/]+/).filter(Boolean);
  if (p.length < 3 || p.length > 4) return null;
  const num = (x, pct) => (x.endsWith('%') ? (parseFloat(x) / 100) * pct : parseFloat(x));
  const a = p.length === 4 ? num(p[3], 1) : 1;
  if ([...p].some((x) => Number.isNaN(parseFloat(x))) || Number.isNaN(a)) return null;
  if (m[1].startsWith('rgb')) return { r: Math.round(num(p[0], 255)), g: Math.round(num(p[1], 255)), b: Math.round(num(p[2], 255)), a };
  const h = (((parseFloat(p[0]) % 360) + 360) % 360) / 360, sat = num(p[1], 1), l = num(p[2], 1);
  const f = (n) => { const k = (n + h * 12) % 12; return l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a };
}

const lum = (c) => {
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export const hexOf = (c) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

// resolved: Map role -> { c: {r,g,b,a}, d, ext? } for one theme. One row per contract pair whose two roles resolved.
export function pairResults(contract, resolved) {
  const out = [];
  for (const p of contract.pairs) {
    const a = resolved.get(p.fg), b = resolved.get(p.bg);
    if (!a || !b) continue;
    const ratio = contrast(a.c, b.c);
    out.push({ fg: p.fg, bg: p.bg, min: p.min, ratio, pass: ratio >= p.min, a, b });
  }
  return out;
}

// Extension text colours (role ends in a contract `extensionInk` suffix) against the ink background.
export function inkResults(contract, resolved) {
  const out = [];
  const bg = resolved.get(contract.extensionInk.bg);
  if (!bg) return out;
  for (const [role, x] of resolved) {
    if (!x.ext) continue;
    const last = role.split('-').pop();
    if (!contract.extensionInk.suffixes.includes(last) || contract.required.color.includes(role)) continue;
    const ratio = contrast(x.c, bg.c);
    out.push({ role, min: contract.extensionInk.min, ratio, pass: ratio >= contract.extensionInk.min, x, bg });
  }
  return out;
}

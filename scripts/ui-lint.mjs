// Fails the build if any src/**/*.tsx component reaches for stock Tailwind
// defaults, mixed radii/shadows, gradients on text, or raw colours instead of
// the theme tokens in src/index.css — and now also scans src/index.css itself
// for the same off-scale radii, off-grid spacing, blurred shadows, extra
// gradients, and un-tokenised colours (item 2). `--self-test` feeds a known-bad
// string and a known-bad CSS block through the same rules and expects each
// named rule to fire at least once.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RULES = [
  { name: 'stock palette class', re: /\b(?:bg|text|border|ring|from|via|to|fill|stroke)-(?:slate|gray|zinc|neutral|indigo|violet|purple|blue)-\d{2,3}\b/ },
  { name: 'oversized rounded corner', re: /\brounded-(?:xl|2xl|3xl)\b/ },
  { name: 'heavy stock shadow', re: /\bshadow-(?:lg|xl|2xl)\b/ },
  { name: 'gradient text/background utility', re: /\bbg-(?:gradient|linear)-/ },
  { name: 'raw hex colour', re: /#[0-9a-fA-F]{3,8}\b/ },
  { name: 'inline style colour', re: /style=\{\{[^}]*(?:color|background)/ },
];

const ALLOW = new Set(['src/export/png.ts']);

function collectFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'ui') continue; // vendored shadcn components, not this repo's authorship
      collectFiles(p, out);
    } else if (/\.(tsx|ts)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function lintText(text, label) {
  const violations = [];
  for (const line of text.split('\n')) {
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    for (const rule of RULES) {
      if (rule.re.test(line)) violations.push(`${label}: ${rule.name} — ${line.trim().slice(0, 100)}`);
    }
  }
  return violations;
}

// --- CSS scan (src/index.css) -----------------------------------------------
// Radius scale: 4px, 8px, 9999px (pill) or 50% (circular avatars/dots). Spacing
// grid: 0, 1px and 2px (hairline gaps) or any multiple of 4px. Shadows: zero
// blur radius only. Gradients and non black/white colours must be var()
// references defined inside the token block (":root { ... }" / "@theme inline
// { ... }"), which is exempt from every rule below.
const RADIUS_SCALE = new Set([4, 8, 9999]);
const isHairlineOrGrid = (n) => n === 0 || n === 1 || n === 2 || n % 4 === 0;
const BLACK_WHITE_RGB = new Set(['0,0,0', '255,255,255']);

function tokenBlockRanges(css) {
  const ranges = [];
  for (const start of [css.indexOf(':root {'), css.indexOf('@theme inline {')]) {
    if (start === -1) continue;
    let depth = 0;
    let i = css.indexOf('{', start);
    const blockStart = i;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    ranges.push([blockStart, i]);
  }
  return ranges;
}

function isInRanges(pos, ranges) {
  return ranges.some(([a, b]) => pos >= a && pos <= b);
}

function lintCss(css, label) {
  const violations = [];
  const ranges = tokenBlockRanges(css);
  let pos = 0;
  for (const rawLine of css.split('\n')) {
    const line = rawLine;
    const lineStart = pos;
    pos += rawLine.length + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    if (isInRanges(lineStart, ranges)) continue;
    const short = trimmed.slice(0, 100);
    const lineNo = css.slice(0, lineStart).split('\n').length;
    // A rule body can carry several declarations on one physical CSS line
    // (e.g. a planted mutation `.x{a:1;b:2;c:3}`); split on `;` so each
    // declaration is checked independently instead of one combined blob.
    const decls = line.split(';');

    for (const decl of decls) {
      if (/border-radius\s*:/.test(decl) && !/var\(/.test(decl)) {
        const pxNums = [...decl.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
        const pctNums = [...decl.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
        const badPx = pxNums.filter((n) => !RADIUS_SCALE.has(n));
        const badPct = pctNums.filter((n) => n !== 50);
        if (badPx.length || badPct.length) violations.push(`${label}:${lineNo}: off-scale border-radius — ${short}`);
      }

      if (/\b(padding|margin|gap|inset)[a-z-]*\s*:/.test(decl) && !/var\(/.test(decl)) {
        const pxNums = [...decl.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
        if (pxNums.some((n) => !isHairlineOrGrid(Math.abs(n)))) violations.push(`${label}:${lineNo}: off-grid spacing — ${short}`);
      }

      if (/box-shadow\s*:/.test(decl)) {
        if (!/var\(/.test(decl) && !/\bnone\b/.test(decl)) {
          const value = decl.replace(/^\s*box-shadow\s*:/, '');
          for (const shadow of value.split(',')) {
            const tokens = shadow
              .replace(/inset/g, '')
              .trim()
              .split(/\s+/)
              .filter((t) => /^-?[\d.]+(px)?$/.test(t));
            // offset-x offset-y [blur-radius] [spread-radius] — blur is the 3rd length.
            const blur = tokens[2] !== undefined ? Number(tokens[2].replace('px', '')) : 0;
            if (blur !== 0) violations.push(`${label}:${lineNo}: blurred box-shadow — ${short}`);
          }
        }
      }

      if (/(?:linear|radial|conic)-gradient\(/.test(decl) && !/^\s*--/.test(decl.trim())) {
        violations.push(`${label}:${lineNo}: raw gradient outside a token — ${short}`);
      }

      for (const m of decl.matchAll(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g)) {
        const hex = m[1].toLowerCase();
        const isBlack = hex === '000' || hex === '000000';
        const isWhite = hex === 'fff' || hex === 'ffffff';
        if (!isBlack && !isWhite) violations.push(`${label}:${lineNo}: raw hex colour outside the token block — ${short}`);
      }
      for (const m of decl.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
        const key = `${m[1]},${m[2]},${m[3]}`;
        if (!BLACK_WHITE_RGB.has(key)) violations.push(`${label}:${lineNo}: raw rgb(a) colour outside the token block — ${short}`);
      }
    }
  }
  return violations;
}

function run() {
  const files = collectFiles('src').filter((f) => !ALLOW.has(f));
  const violations = files.flatMap((f) => lintText(readFileSync(f, 'utf8'), f));
  violations.push(...lintCss(readFileSync('src/index.css', 'utf8'), 'src/index.css'));
  return violations;
}

if (process.argv.includes('--self-test')) {
  const bad = lintText('<div className="bg-indigo-500 rounded-2xl shadow-lg" style={{ color: "#fff" }} />', 'self-test');
  const cssCases = [
    ['off-scale border-radius', '.x { border-radius: 10px; }'],
    ['off-grid spacing', '.x { padding: 7px; }'],
    ['blurred box-shadow', '.x { box-shadow: 0 6px 18px #000; }'],
    ['raw gradient outside a token', '.x { background: linear-gradient(#fff, #000); }'],
    ['raw hex colour outside the token block', '.x { color: #123456; }'],
    ['raw rgb(a) colour outside the token block', '.x { color: rgba(10, 20, 30, 0.5); }'],
  ];
  let cssHits = 0;
  const missed = [];
  for (const [name, css] of cssCases) {
    const hits = lintCss(css, 'self-test-css');
    if (hits.some((v) => v.includes(name))) cssHits++;
    else missed.push(name);
  }
  if (bad.length >= 4 && cssHits === cssCases.length) {
    console.log(`ui-lint self-test PASS (caught ${bad.length} planted tsx violations, ${cssHits}/${cssCases.length} planted CSS rules)`);
    process.exit(0);
  }
  console.log(`ui-lint self-test FAIL — tsx violations: ${bad.length}, missed CSS rules: ${missed.join(', ') || 'none'}`);
  process.exit(1);
}

const violations = run();
if (violations.length) {
  console.log(`ui-lint FAIL — ${violations.length} violation(s):`);
  for (const v of violations) console.log(`  ${v}`);
  process.exit(1);
}
console.log('ui-lint PASS — no stock defaults, off-scale CSS, or off-token colours found');
process.exit(0);

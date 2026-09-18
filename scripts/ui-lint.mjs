// Fails the build if any src/**/*.tsx component reaches for stock Tailwind
// defaults, mixed radii/shadows, gradients on text, or raw colours instead of
// the theme tokens in src/index.css. `--self-test` feeds a known-bad string
// through the same rules and expects at least one violation.
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

function run() {
  const files = collectFiles('src').filter((f) => !ALLOW.has(f));
  const violations = files.flatMap((f) => lintText(readFileSync(f, 'utf8'), f));
  return violations;
}

if (process.argv.includes('--self-test')) {
  const bad = lintText('<div className="bg-indigo-500 rounded-2xl shadow-lg" style={{ color: "#fff" }} />', 'self-test');
  if (bad.length >= 4) {
    console.log(`ui-lint self-test PASS (caught ${bad.length} planted violations)`);
    process.exit(0);
  }
  console.log('ui-lint self-test FAIL — did not catch planted violations');
  process.exit(1);
}

const violations = run();
if (violations.length) {
  console.log(`ui-lint FAIL — ${violations.length} violation(s):`);
  for (const v of violations) console.log(`  ${v}`);
  process.exit(1);
}
console.log('ui-lint PASS — no stock defaults or off-token colours found');
process.exit(0);

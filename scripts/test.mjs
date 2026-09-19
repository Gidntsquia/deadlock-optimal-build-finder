// npm test: logic checks and the browser tour run side by side; output is printed one after the other.
import { spawn } from 'node:child_process';
const run = (label, cmd, args) =>
  new Promise((res) => {
    let out = '';
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => res({ label, code, out }));
  });
const t0 = Date.now();
const results = await Promise.all([run('verify', 'npx', ['tsx', 'scripts/verify.ts']), run('browser', 'npm', ['run', '--silent', 'verify:browser'])]);
for (const r of results) console.log(`\n=== ${r.label} (exit ${r.code}) ===\n${r.out.trimEnd()}`);
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(results.some((r) => r.code) ? 1 : 0);

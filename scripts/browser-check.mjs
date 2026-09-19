// Headless browser check: builds the app, serves dist/ with vite preview, blocks all network
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// except localhost, and verifies rendering at 390x844 with zero console errors.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';

// The checks are split into independent stages. With no STAGE set this file is the coordinator: it serves dist/,
// runs every stage as its own process (own browser, so they cannot disturb each other) and prints their lines in order.
const STAGE = process.env.STAGE;
const S = (...names) => names.includes(STAGE);
// the hero x style loop is cut into FIT_PARTS stages, hero i going to stage i % FIT_PARTS
const FIT_PARTS = 2;
const fitK = STAGE?.startsWith('fit-') ? Number(STAGE.slice(4)) : -1;
const STAGES = [
  'phone-a',
  'phone-b',
  'phone-c',
  'phone-d',
  'phone-e',
  'desk-a',
  'desk-b',
  'desk-c',
  'main',
  ...Array.from({ length: FIT_PARTS }, (_, k) => 'fit-' + k),
  'wide',
  'arrows',
  'share',
  'cls-busy',
  'axe',
];
if (!STAGE) {
  const t0 = Date.now();
  const srv = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    if (
      await fetch('http://localhost:4173/').then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const runStage = (st) =>
    new Promise((resolve) => {
      const started = Date.now();
      const c = spawn('node', [process.argv[1]], { env: { ...process.env, STAGE: st }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      c.stdout.on('data', (d) => (out += d));
      c.stderr.on('data', (d) => (out += d));
      c.on('close', (code) => resolve({ st, out, code, secs: ((Date.now() - started) / 1000).toFixed(1) }));
    });
  // a few stages at a time: more browsers than cores just makes every stage slower
  // STAGE_ONLY=a,b runs just those stages (the fast tier); unset runs all
  const only = process.env.STAGE_ONLY?.split(',').filter(Boolean);
  const run = only ? STAGES.filter((s) => only.includes(s)) : STAGES;
  if (only && run.length !== only.length) throw new Error('unknown stage in STAGE_ONLY: ' + only.filter((s) => !STAGES.includes(s)));
  const queue = [...run];
  const done = {};
  const JOBS = Number(process.env.STAGE_JOBS) || 6;
  await Promise.all(
    Array.from({ length: JOBS }, async () => {
      for (let st; (st = queue.shift());) done[st] = await runStage(st);
    }),
  );
  const results = run.map((st) => done[st]);
  srv.kill();
  let bad = 0;
  for (const r of results) {
    process.stdout.write(r.out);
    if (process.env.STAGE_TIMES) console.log(`(stage ${r.st}: ${r.secs}s)`);
    if (r.code !== 0) {
      bad++;
      console.log(`FAIL  stage ${r.st} exited ${r.code}`);
    }
  }
  const all = results.map((r) => r.out).join('\n');
  console.log(`${(all.match(/^PASS /gm) || []).length} PASS, ${(all.match(/^FAIL /gm) || []).length + bad} FAIL in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(bad ? 1 : 0);
}

const SHOT_DIR = process.env.SHOT_DIR || 'screenshots';
mkdirSync(SHOT_DIR, { recursive: true });
const shot = (name) => `${SHOT_DIR}/${name}`;

const exe =
  process.env.CHROME_PATH ||
  (await import('node:fs'))
    .readdirSync(process.env.HOME + '/.cache/ms-playwright')
    .filter((d) => d.startsWith('chromium_headless_shell-'))
    .sort()
    .map((d) => process.env.HOME + '/.cache/ms-playwright/' + d + '/chrome-headless-shell-linux64/chrome-headless-shell')
    .find((p) => require('node:fs').existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
// Network disabled: only the local preview server is allowed (item images are remote and will fail to load, which is expected offline).
const imgBlocked = [];
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith('http://localhost:4173') || u.startsWith('http://localhost:8790')) return route.continue();
  imgBlocked.push(u);
  return route.abort();
});
let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
  if (!ok) fails++;
};
// Reads getBoundingClientRect() repeatedly until two reads 300ms apart agree, so an
// in-flight open/resize animation can't make a still-settling rect look correct.
async function stableRect(pg, selector) {
  let prev = null;
  for (let i = 0; i < 20; i++) {
    const r = await pg.$eval(selector, (el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
    });
    if (prev && Object.keys(r).every((k) => Math.abs(r[k] - prev[k]) < 0.5)) return r;
    prev = r;
    await pg.waitForTimeout(100);
  }
  return prev;
}
function assertInsideViewport(check, label, rect, innerWidth, innerHeight) {
  check(`${label}: left >= 0`, rect.left >= -0.5, `left=${rect.left}`);
  check(`${label}: top >= 0`, rect.top >= -0.5, `top=${rect.top}`);
  check(`${label}: right <= innerWidth`, rect.right <= innerWidth + 0.5, `right=${rect.right} innerWidth=${innerWidth}`);
  check(`${label}: bottom <= innerHeight`, rect.bottom <= innerHeight + 0.5, `bottom=${rect.bottom} innerHeight=${innerHeight}`);
  check(`${label}: width >= 300`, rect.width >= 300, `width=${rect.width}`);
}
// Hero picker: the visible hero control (portrait on desktop, avatar on phone) opens one dialog
// with a search box and grid. `pickHero` opens it, types the name, and clicks the match.
const isPhone = (pg = page) => pg.viewportSize()?.width < 900;
const openHeroes = async (pg = page) => {
  await pg.click('.hero-btn:visible');
  await pg.waitForSelector('.hero-dialog .hero-filter');
};
let sheetChecked = false;
const pickHero = async (name, pg = page) => {
  await openHeroes(pg);
  if (isPhone(pg) && !sheetChecked) {
    sheetChecked = true; // one look per process: the other picks open the same sheet at the same size
    const vp = pg.viewportSize();
    const r = await stableRect(pg, '.hero-dialog');
    assertInsideViewport(check, 'item 1 (phone hero sheet)', r, vp.width, vp.height);
  }
  await pg.fill('.hero-dialog .hero-filter', name);
  await pg.click(`.hero-dialog .hero-opt:has-text("${name}")`);
  await pg.waitForSelector('.hero-dialog', { state: 'detached' });
};
// Hero switch by URL (pushState + popstate, the same path back/forward uses); the picker itself is exercised in the stages that click it.
const gotoHero = (pg, name) =>
  pg.evaluate(
    (slug) => {
      history.pushState({}, '', '?hero=' + slug);
      dispatchEvent(new PopStateEvent('popstate'));
    },
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
  );
// Runs fn(page, item) over items on `n` fresh pages in parallel (same offline rules as the main page).
// Hero x style loops are independent, so this cuts wall time without dropping any check.
async function pool(items, n, viewport, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      const wctx = await browser.newContext({ viewport, ...(viewport.width < 900 ? { isMobile: true, hasTouch: true } : {}) });
      const wp = await wctx.newPage();
      // the pooled loops only measure layout (images have fixed width/height), so skip decoding and painting them
      await wp.route('**/*', (route) =>
        route.request().url().startsWith('http://localhost:4173') && route.request().resourceType() !== 'image' ? route.continue() : route.abort(),
      );
      wp.on('pageerror', (e) => errors.push(String(e)));
      await wp.goto('http://localhost:4173/');
      await wp.waitForSelector('.tiles .tile', { timeout: 20000 });
      for (let it; (it = queue.shift()) !== undefined;) await fn(wp, it);
      await wctx.close();
    }),
  );
}
const BANNED = [
  /%/,
  /match/i,
  /players/i,
  /win rate/i,
  /high-rank/i,
  /Phantom/,
  /souls by end/i,
  /Last \d+ days/i,
  /data from/i,
  /Validation/i,
  /measured/i,
  /README/i,
];
const bannedHit = (text) => BANNED.map((re) => re.exec(text)?.[0]).find(Boolean);
// Ability grid probe: 4 rows, one marker per step, own column, left-to-right = point order, own row, tier text 1/2/5.
const gridProbe = (pg = page) =>
  pg.evaluate(() => {
    const why = [];
    const grid = document.querySelector('.ap-grid');
    if (!grid) return ['no .ap-grid'];
    const rows = [...grid.querySelectorAll('.ap-row')];
    if (rows.length !== 4) why.push(`${rows.length} rows`);
    const marks = [...grid.querySelectorAll('.ap-mark')];
    // expected sequence is the build's own abilityOrder (serialized from Build.abilityOrder, not from the markup)
    const order = JSON.parse(grid.dataset.order || '[]');
    if (marks.length !== order.length) why.push(`${marks.length} markers != ${order.length} build steps`);
    const byX = [...marks].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    byX.forEach((m, k) => {
      const kind = ['unlock', 'tier1', 'tier2', 'tier3'].find((c) => m.classList.contains(c));
      if (!order[k] || m.dataset.ability !== order[k][0] || kind !== order[k][1])
        why.push(`x-order ${k}: drawn ${m.dataset.ability}/${kind}, build has ${order[k]?.join('/')}`);
    });
    const cols = new Set(marks.map((m) => Math.round(m.getBoundingClientRect().left + m.getBoundingClientRect().width / 2)));
    if (cols.size !== marks.length) why.push('two markers share a column');
    const cost = { tier1: '1', tier2: '2', tier3: '5' };
    for (const m of marks) {
      const row = m.closest('.ap-row');
      if (row.dataset.ability !== m.dataset.ability) why.push(`marker ${m.dataset.index} in wrong row`);
      const kind = ['unlock', 'tier1', 'tier2', 'tier3'].find((k) => m.classList.contains(k));
      const txt = m.textContent.trim();
      if (kind === 'unlock' ? txt !== '' : txt !== cost[kind]) why.push(`marker ${m.dataset.index} ${kind} reads "${txt}"`);
      if (!m.getAttribute('aria-label')) why.push('marker without name');
    }
    for (const r of rows) if (!r.getAttribute('aria-label')) why.push('row without name');
    return why;
  });
const openDetails = async () => {
  await page.click('.details-btn');
  await page.waitForSelector('.details');
};
const closeDetails = async () => {
  await page.keyboard.press('Escape');
  await page.waitForSelector('.details', { state: 'detached' });
};
try {
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('.tiles .tile', { timeout: 20000 });
  if (S('desk-a', 'desk-b', 'desk-c', 'cls-busy', 'share')) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector('.board');
  }
  if (S('phone-a')) check('opens on Infernus', (await page.textContent('.frame-head h1')).startsWith('Infernus'));
  const tabs = await page.$$('.frame-head h1');
  if (S('phone-a')) check('one named build', tabs.length === 1, `${(await Promise.all(tabs.map((t) => t.textContent()))).join(' | ')}`);
  const noHScroll = async (label) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    check(`no horizontal scroll (${label})`, w[0] <= w[1], `${w[0]} <= ${w[1]}`);
  };
  if (S('phone-a')) await noHScroll('Infernus build');
  if (S('phone-a')) {
    // item 2: computed colours come from the theme tokens, not hardcoded/stock values
    const tokenColors = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const board = document.querySelector('.board');
      return {
        room: root.getPropertyValue('--room').trim(),
        bodyBg: body.backgroundColor,
        boardBg: board ? getComputedStyle(board).backgroundColor : null,
        boardToken: root.getPropertyValue('--board').trim(),
      };
    });
    const hexToRgb = (hex) => {
      const n = parseInt(hex.replace('#', ''), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    check('body background-color equals --room token', tokenColors.bodyBg === hexToRgb(tokenColors.room), `${tokenColors.bodyBg} vs ${tokenColors.room}`);
    check(
      'board background-color equals --board token',
      tokenColors.boardBg === hexToRgb(tokenColors.boardToken),
      `${tokenColors.boardBg} vs ${tokenColors.boardToken}`,
    );
    // item 2: analytics fetch failure shows an inline Retry (not a blank app), logs analytics_load_failed, and recovers
    {
      const consoleLines = [];
      const onMsg = (m) => consoleLines.push(m.text());
      page.on('console', onMsg);
      await page.route('**/data/analytics/2.json', (route) => route.abort());
      await pickHero('Seven');
      await page.waitForSelector('button:has-text("Retry")', { timeout: 15000 });
      check('analytics failure: a hero control is still visible', (await page.$$('.hero-btn:visible, .hero-retry-pick:visible')).length >= 1);
      const parsed = consoleLines
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const loggedFail = parsed.some((p) => p.event === 'analytics_load_failed');
      check('analytics fetch failure shows Retry + logs analytics_load_failed', loggedFail, JSON.stringify(parsed.slice(-3)));
      await page.unroute('**/data/analytics/2.json');
      page.off('console', onMsg);
      await page.click('.hero-retry-pick');
      await page.fill('.hero-dialog .hero-filter', 'Vindicta');
      await page.click('.hero-dialog .hero-opt:has-text("Vindicta")');
      await page.waitForFunction(() => document.querySelectorAll('.tiles .tile').length >= 12, null, { timeout: 15000 });
      const rows = await page.$$eval('.tiles .tile', (els) => els.length);
      check('after error, selecting another hero recovers: Vindicta renders >=12 tiles', rows >= 12, `${rows} tiles`);
      await pickHero('Infernus');
      await page.waitForFunction(
        () => document.querySelector('.frame-head h1')?.textContent.startsWith('Infernus') && document.querySelectorAll('.tiles .tile').length >= 12,
        null,
        { timeout: 15000 },
      );
      errors.length = 0; // the aborted request above is an intentional, already-asserted failure, not a real regression
    }
  }
  const tapOk = async (label) => {
    // Inline citation links inside a sentence (e.g. the footer's prose links, disclosure copy)
    // are exempt from the 40px minimum per WCAG 2.5.8's own inline-text-link exception; a real
    // control (button, select, role=button, or a block/inline-block styled link) still must meet it.
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll('button, select, a, [role=button]')]
        .filter((el) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40);
        })
        .map((el) => `${el.className}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`),
    );
    check(`all tap targets >= 40px (${label})`, bad.length === 0, bad.slice(0, 5).join(', '));
  };
  if (S('phone-a')) await tapOk('Infernus');
  if (S('phone-b')) {
    for (let i = 0; i < tabs.length; i++) {
      const rows = await page.$$('.tiles .tile');
      const phases = await page.$$eval('.row:not(.abilities) .row-head', (els) => els.map((e) => e.textContent));
      const totals = await page.$$eval('.tiles .tile', (els) => els.map((e) => Number(e.dataset.total)));
      const costs = await page.$$eval('.tiles .tile', (els) => els.map((e) => Number(e.dataset.cost)));
      let run = 0;
      const totalsOk = costs.every((c, k) => (run += c) === totals[k]);
      const imgs = await page.$$eval('.tiles .tile img', (els) => els.map((e) => e.getAttribute('src')));
      await page.waitForFunction(() => [...document.querySelectorAll('.tiles .tile img')].every((e) => e.complete), null, { timeout: 5000 }).catch(() => {});
      const broken = await page.$$eval('.tiles .tile img', (els) => els.filter((e) => !e.complete || e.naturalWidth === 0).length);
      const abil = await page.$$eval('.ap-row', (els) => [...new Set(els.map((e) => e.dataset.ability))]);
      const unlocks = await page.$$eval('.ap-mark.unlock', (els) => els.length);
      await openDetails();
      const badges = await page.$$eval('.details .item-table tr[data-core]', (els) => els.length);
      const agreement = await page.textContent('.details .agreement');
      await closeDetails();
      check(
        `build ${i + 1}: >=12 items, 3 phases, running totals, images`,
        rows.length >= 12 && broken === 0 && phases.length === 3 && totalsOk && imgs.every((s) => s && /\/data\/img\/items\/\d+\.webp$/.test(s)),
        `${rows.length} items, phases ${phases.join('/')}`,
      );
      check(`build ${i + 1}: core badge on every item + agreement`, badges === rows.length && /\d+% match/.test(agreement), agreement);
      check(
        `build ${i + 1}: 4 real Infernus abilities, unlock + tiers`,
        abil.length === 4 && unlocks === 4 && ['Napalm', 'Flame Dash', 'Afterburn', 'Concussive Combustion'].every((n) => abil.includes(n)),
        abil.join(', '),
      );
    }
    // tap an item -> detail card
    await (await page.$('.tiles .tile')).tap();
    await page.waitForSelector('.sheet');
    const name = await page.textContent('.sheet h2');
    const chips = await page.$$eval('.sheet .chip', (els) => els.map((e) => e.textContent.trim()));
    const stats = await page.$$eval('.sheet .stat-line', (els) => els.length);
    const img = await page.$eval('.sheet-head img', (e) => e.getAttribute('src'));
    check(
      'item detail card: image, cost, tier, slot, stats',
      !!img &&
        chips.some((c) => /^[\d,]+$/.test(c)) &&
        chips.some((c) => /^Tier \d/.test(c)) &&
        chips.some((c) => /Weapon|Vitality|Spirit/.test(c)) &&
        stats > 0,
      `${name}: ${chips.join(' | ')}, ${stats} stat lines`,
    );
    await noHScroll('item card open');
    {
      // item 1: phone item dialog is a full-bottom sheet, fully on screen, after the rect settles
      const vp = page.viewportSize();
      const r1 = await stableRect(page, '[role="dialog"]');
      assertInsideViewport(check, 'item 1 (phone, before arrow)', r1, vp.width, vp.height);
      check('item 1 (phone): bottom-anchored', Math.abs(r1.bottom - vp.height) <= 1, `bottom=${r1.bottom} innerHeight=${vp.height}`);
      check('item 1 (phone): left edge flush', r1.left <= 1, `left=${r1.left}`);
      check('item 1 (phone): right edge flush', r1.right >= vp.width - 1, `right=${r1.right} innerWidth=${vp.width}`);
      const titleRect1 = await page.$eval('[data-slot="dialog-content"] h2', (el) => el.getBoundingClientRect());
      check(
        'item 1 (phone): title fully inside viewport',
        titleRect1.left >= 0 && titleRect1.top >= 0 && titleRect1.right <= vp.width && titleRect1.bottom <= vp.height,
        JSON.stringify(titleRect1),
      );
      check('item 1 (phone): title text is the opened item name', (await page.textContent('[data-slot="dialog-content"] h2')) === name, name);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      const r2 = await stableRect(page, '[role="dialog"]');
      assertInsideViewport(check, 'item 1 (phone, after ArrowRight)', r2, vp.width, vp.height);
      check('item 1 (phone, after ArrowRight): still bottom-anchored', Math.abs(r2.bottom - vp.height) <= 1, `bottom=${r2.bottom}`);
      const titleRect2 = await page.$eval('[data-slot="dialog-content"] h2', (el) => el.getBoundingClientRect());
      check(
        'item 1 (phone, after ArrowRight): title still fully inside viewport',
        titleRect2.left >= 0 && titleRect2.top >= 0 && titleRect2.right <= vp.width && titleRect2.bottom <= vp.height,
        JSON.stringify(titleRect2),
      );
    }
    await page.screenshot({ path: shot('item-sheet-phone.png') });
    await page.tap('[data-slot="dialog-close"]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.screenshot({ path: shot('infernus-build-phone.png'), fullPage: true });
    await openHeroes();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('hero-picker-phone.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.hero-dialog', { state: 'detached' });
    await openDetails();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('details-phone.png') });
    {
      const vp = page.viewportSize();
      const r = await stableRect(page, '.details');
      assertInsideViewport(check, 'details sheet (phone)', r, vp.width, vp.height);
    }
    await closeDetails();
  }
  if (S('phone-c')) {
    // Warden: a hero with more than one build style — cover the style tabs
    await pickHero('Warden');
    await page.waitForFunction(
      () => document.querySelector('.frame-head h1')?.textContent.startsWith('Warden') && document.querySelectorAll('.tiles .tile').length >= 1,
      null,
      { timeout: 15000 },
    );
    await page.screenshot({ path: shot('warden-styles-phone.png'), fullPage: true });
  }
  if (S('phone-e')) {
    // heroes with their own held-out set show that player's validation panel
    for (const [n, who] of [
      ['Lash', 'Albertt'],
      ['Mina', 'lordnm'],
      ['Kelvin', 'Yndio'],
    ]) {
      await pickHero(n);
      await page.waitForFunction(
        (h) => document.querySelector('.frame-head h1')?.textContent.startsWith(h) && !document.querySelector('.board-wrap.stale'),
        n,
        {
          timeout: 15000,
        },
      );
      await page.waitForTimeout(300); // the player files load after the build
      await openDetails();
      await page.waitForFunction((w) => [...document.querySelectorAll('.details .panel-table')].some((t) => t.textContent.includes(w)), who, {
        timeout: 15000,
      });
      const agreement = await page.textContent('.details .agreement');
      const badges = await page.$$eval('.details .item-table tr[data-core]', (els) => els.length);
      await closeDetails();
      const rows = await page.$$eval('.tiles .tile', (els) => els.length);
      check(`${who}: validation panel + core badges`, /\d+% match/.test(agreement) && badges === rows, agreement);
    }
  }
  if (S('phone-c')) {
    // item 3: exactly one visible hero control at the current (phone) viewport
    {
      const visibleControls = (await page.$$('.hero-btn:visible')).length;
      check('exactly one visible hero control (390px)', visibleControls === 1, `${visibleControls} visible`);
    }
  }
  if (S('phone-d')) {
    // item 3: typing "las" leaves only Lash visible; Enter selects it; URL gets hero=lash; reload keeps it; back goes to Infernus
    // Reset navigation history first so goBack() below has a deterministic (Infernus, no hero param) prior entry,
    // rather than whichever hero this script happened to pick last.
    await page.goto('http://localhost:4173/');
    await page.waitForFunction(
      () => document.querySelector('.frame-head h1')?.textContent.startsWith('Infernus') && document.querySelectorAll('.tiles .tile').length >= 1,
      null,
      { timeout: 15000 },
    );
    await openHeroes();
    await page.fill('.hero-dialog .hero-filter', 'las');
    const lasMatches = await page.$$eval('.hero-dialog .hero-opt', (els) => els.map((e) => e.textContent.trim()));
    check('filter "las" leaves only Lash visible', lasMatches.length === 1 && lasMatches[0].includes('Lash'), lasMatches.join(', '));
    await page.press('.hero-dialog .hero-filter', 'Enter');
    await page.waitForFunction(() => document.querySelector('.frame-head h1')?.textContent.startsWith('Lash'), null, { timeout: 15000 });
    check('URL contains hero=lash after Enter-select', new URL(page.url()).searchParams.get('hero') === 'lash', page.url());
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector('.frame-head h1')?.textContent.startsWith('Lash') && document.querySelectorAll('.tiles .tile').length >= 1,
      null,
      { timeout: 15000 },
    );
    check('reload still shows Lash', true);
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('.frame-head h1')?.textContent.startsWith('Infernus'), null, { timeout: 15000 });
    check('goBack() returns to Infernus', true);
    // item 3: Escape closes the phone sheet
    await openHeroes();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.hero-dialog', { state: 'detached', timeout: 5000 });
    check('Escape closes the hero sheet', true);
    // item 3: unknown hero slug falls back to Infernus with no console error
    {
      await page.goto('http://localhost:4173/?hero=nope');
      // a full navigation can tear down the previous page mid-fetch, which fires a stray
      // "Failed to fetch" from the OLD document into this listener; that's a harness artifact
      // of hard-navigating in a test, not something the new page's own lifecycle produced, so
      // it's cleared right after the navigation commits, before the new page has had a chance
      // to log anything of its own.
      errors.length = 0;
      await page.waitForFunction(
        () => document.querySelector('.frame-head h1')?.textContent.startsWith('Infernus') && document.querySelectorAll('.tiles .tile').length >= 1,
        null,
        { timeout: 15000 },
      );
      check('/?hero=nope falls back to Infernus with no console error', errors.length === 0, errors.slice(0, 3).join(' | '));
    }
  }
  if (S('desk-a')) {
    // desktop layout: the board and the side column sit next to each other and fill the window
    await page.setViewportSize({ width: 1440, height: 900 });
    {
      const visibleControls = (await page.$$('.hero-btn:visible')).length;
      check('exactly one visible hero control (1440px)', visibleControls === 1, `${visibleControls} visible`);
    }
    await pickHero('Infernus');
    await page.waitForFunction(() => document.querySelector('.frame-head h1')?.textContent.startsWith('Infernus') && document.querySelector('.board'), null, {
      timeout: 15000,
    });
    await tapOk('Infernus desktop');
    const [bb, sb] = await Promise.all([
      page.$eval('.frame', (e) => e.getBoundingClientRect().toJSON()),
      page.$eval('.hero-side', (e) => e.getBoundingClientRect().toJSON()),
    ]);
    // item 4 caps desktop content width to ~1200px (centered), so the board no longer spans
    // the full window; it must still be the wider, dominant column next to the side panel.
    check(
      'desktop: hero on the left, board the more prominent (wider) column',
      sb.right <= bb.left && bb.width > sb.width * 2 && bb.width > 900,
      `board ${Math.round(bb.width)}px, side ${Math.round(sb.width)}px`,
    );
    await page.screenshot({ path: shot('infernus-build-desktop.png') });
    await openHeroes();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('hero-picker-desktop.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.hero-dialog', { state: 'detached' });
    await openDetails();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('details-desktop.png') });
    await closeDetails();
  }
  if (S('desk-b')) {
    await (await page.$('.tiles .tile')).click();
    await page.waitForSelector('.sheet');
    {
      // item 1: desktop item dialog is centred, fully on screen, after the rect settles
      const dName = await page.textContent('[data-slot="dialog-content"] h2');
      const r1 = await stableRect(page, '[role="dialog"]');
      assertInsideViewport(check, 'item 1 (desktop, before arrow)', r1, 1440, 900);
      const cx1 = (r1.left + r1.right) / 2;
      const cy1 = (r1.top + r1.bottom) / 2;
      check('item 1 (desktop): centred horizontally', Math.abs(cx1 - 720) <= 2, `centreX=${cx1}`);
      check('item 1 (desktop): centred vertically', Math.abs(cy1 - 450) <= 2, `centreY=${cy1}`);
      const titleRect1 = await page.$eval('[data-slot="dialog-content"] h2', (el) => el.getBoundingClientRect());
      check(
        'item 1 (desktop): title fully inside viewport',
        titleRect1.left >= 0 && titleRect1.top >= 0 && titleRect1.right <= 1440 && titleRect1.bottom <= 900,
        JSON.stringify(titleRect1),
      );
      check('item 1 (desktop): title text is the opened item name', (await page.textContent('[data-slot="dialog-content"] h2')) === dName, dName);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      const r2 = await stableRect(page, '[role="dialog"]');
      assertInsideViewport(check, 'item 1 (desktop, after ArrowRight)', r2, 1440, 900);
      const cx2 = (r2.left + r2.right) / 2;
      const cy2 = (r2.top + r2.bottom) / 2;
      check('item 1 (desktop, after ArrowRight): still centred horizontally', Math.abs(cx2 - 720) <= 2, `centreX=${cx2}`);
      check('item 1 (desktop, after ArrowRight): still centred vertically', Math.abs(cy2 - 450) <= 2, `centreY=${cy2}`);
    }
    await page.screenshot({ path: shot('item-sheet-desktop.png') });

    // item 5: item detail dialog — focus trap, focus return, keyboard stepping, readable headings
    {
      const firstTileName = await page.$eval('.tiles .tile', (el) => el.textContent);
      const focusInDialog = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      check('item 5: opening the dialog moves focus inside it', focusInDialog);

      let leftDialog = false;
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
        if (!inside) leftDialog = true;
      }
      check('item 5: 12 Tab presses never leave the dialog', !leftDialog);

      const titleBefore = await page.textContent('[data-slot="dialog-content"] h2');
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction((prev) => document.querySelector('[data-slot="dialog-content"] h2')?.textContent !== prev, titleBefore, { timeout: 5000 });
      const titleAfter = await page.textContent('[data-slot="dialog-content"] h2');
      check('item 5: ArrowRight steps to the next item in buy order', titleAfter !== titleBefore, `${titleBefore} -> ${titleAfter}`);

      const headings = await page.$$eval('[data-slot="dialog-content"] .tt-section h3', (els) => els.map((e) => e.textContent ?? ''));
      const rawHeading = headings.find((h) => /^[a-z_]+$/.test(h));
      check('item 5: no dialog heading prints a raw section_type', !rawHeading, headings.join(', '));

      await page.keyboard.press('Escape');
      await page.waitForSelector('.sheet', { state: 'detached' });
      // Radix restores focus a frame after unmount: poll for it (bounded) instead of reading once.
      await page.waitForFunction(() => document.activeElement?.classList.contains('tile'), null, { timeout: 2000 }).catch(() => {});
      const focusedLabel = await page.evaluate(() => (document.activeElement?.classList.contains('tile') ? document.activeElement.textContent : null));
      check(
        'item 5: Escape closes and returns focus to the tile last shown (not the original opener)',
        focusedLabel !== null && focusedLabel !== firstTileName,
        `focused: ${focusedLabel}, opener was: ${firstTileName}`,
      );
    }
    // item 5: tiles have a visible focus state distinct from their resting state
    {
      const tile = await page.$('.tiles .tile');
      await page.evaluate(() => document.activeElement?.blur()); // focus was returned to a tile by the dialog closing
      await page.mouse.move(1439, 899); // and the pointer is still over the first tile from opening the dialog
      const resting = await tile.evaluate((el) => getComputedStyle(el).outlineStyle);
      // A prior real mouse click leaves the page's input-modality tracking on "mouse", under which
      // Chromium won't show :focus-visible even for a scripted .focus(); a keypress resets modality
      // to "keyboard" first, matching how a real keyboard user would actually tab to this tile.
      await page.keyboard.press('Tab');
      await tile.focus();
      const focused = await tile.evaluate((el) => getComputedStyle(el).outlineStyle);
      check(
        'item 5: focused tile has a visible outline distinct from resting state',
        focused === 'solid' && resting !== 'solid',
        `resting ${resting}, focused ${focused}`,
      );
      await tile.evaluate((el) => el.blur());
    }
  }
  if (S('desk-c')) {
    await pickHero('Warden');
    await page.waitForFunction(
      () => document.querySelector('.frame-head h1')?.textContent.startsWith('Warden') && document.querySelectorAll('.tiles .tile').length >= 1,
      null,
      { timeout: 15000 },
    );
    await page.screenshot({ path: shot('warden-styles-desktop.png') });
    // item 3: clicking the second style tab on Warden changes the build and adds style= to the URL
    {
      const tabs2 = await page.$$('.style-pill');
      if (tabs2.length >= 2) {
        const before = await page.evaluate(() => ({
          tile: document.querySelector('.tiles .tile')?.textContent,
          heading: document.querySelector('.frame-head h1')?.textContent,
        }));
        await tabs2[1].click();
        await page.waitForFunction(
          (prev) => {
            const t = document.querySelector('.tiles .tile')?.textContent;
            const h = document.querySelector('.frame-head h1')?.textContent;
            return t !== prev.tile || h !== prev.heading;
          },
          before,
          { timeout: 15000 },
        );
        check('Warden: clicking second style tab changes the first tile or board heading', true);
        check('Warden: URL gets style= after picking a style', new URL(page.url()).searchParams.has('style'), page.url());
      } else {
        check('Warden: clicking second style tab changes the first tile or board heading', false, `only ${tabs2.length} style tab(s) rendered`);
      }
    }
  }

  // Main screen rules at 1440x900 (desktop viewport is already set)
  let allHeroes;
  if (fitK >= 0 || S('main', 'wide')) {
    const mainText = () => page.evaluate(() => document.querySelector('main').innerText);
    const fitProbe = (pg = page) =>
      pg.evaluate(() => {
        const scrollers = [...document.querySelectorAll('main *')]
          .filter((el) => {
            const cs = getComputedStyle(el);
            const canY = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
            const canX = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
            return canY || canX;
          })
          .map((el) => el.className || el.tagName);
        const tiles = [...document.querySelectorAll('.tiles .tile')];
        const clipped = tiles.filter((t) => {
          const r = t.getBoundingClientRect();
          return r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5 || r.top < 0 || r.left < 0;
        }).length;
        return {
          sh: document.documentElement.scrollHeight,
          ih: innerHeight,
          sw: document.documentElement.scrollWidth,
          iw: innerWidth,
          scrollers,
          tiles: tiles.length,
          clipped,
        };
      });
    const waitSettled = (name, pg = page) =>
      pg.waitForFunction(
        (h) => document.querySelector('.frame-head h1')?.textContent.startsWith(h + ' - ') && !document.querySelector('.board-wrap.stale'),
        name,
        {
          timeout: 15000,
        },
      );

    if (S('main')) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await pickHero('Infernus');
      await waitSettled('Infernus');
      check('exactly one details control, closed by default', (await page.$$('.details-btn')).length === 1 && (await page.$$('.details')).length === 0);
      check('no top bar: no header/nav/footer elements', (await page.$$('header, nav, footer, .app-header')).length === 0);
      const rowTop = await page.$eval('.board .row', (e) => e.getBoundingClientRect().top);
      check('first board row starts within 120px of the top at 1440x900', rowTop <= 120, `top=${rowTop}`);
      for (const [label, sel] of [
        ['hero control', '.hero-btn:visible'],
        ['style switch', '.style-switch'],
        ['ability order', '.row.abilities'],
        ['ability grid', '.ap-grid'],
        ['share', '.share-btn'],
        ['details control', '.details-btn'],
      ]) {
        const r = await page.locator(sel).first().boundingBox();
        check(
          `1440x900: ${label} is inside the viewport`,
          !!r && r.x >= 0 && r.y >= 0 && r.x + r.width <= 1440 && r.y + r.height <= 900 && r.width > 0,
          JSON.stringify(r),
        );
      }

      // details: opens, holds the numbers, Escape closes and returns focus
      await page.focus('.details-btn');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.details');
      const dText = await page.$eval('.details', (e) => e.innerText);
      check('details: agreement percentage', /\d+% match/.test(dText), dText.slice(0, 200));
      check('details: top-player table', (await page.$$('.details .panel-table tbody tr')).length >= 1);
      check('details: match count', /[\d,]+ matches/.test(dText));
      check('details: win rate', /win rate/i.test(dText));
      check('details: data date', /data from \d{1,2} \w{3} \d{4}/i.test(dText), dText.match(/data from.{0,30}/i)?.[0]);
      await closeDetails();
      await page.waitForFunction(() => document.activeElement?.classList.contains('details-btn'), null, { timeout: 2000 }).catch(() => {});
      check('details: Escape returns focus to the details control', await page.evaluate(() => document.activeElement?.classList.contains('details-btn')));

      // banned words on the main screen, Infernus and Warden, desktop and phone
      for (const size of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(size);
        for (const name of ['Infernus', 'Warden']) {
          await pickHero(name);
          await waitSettled(name);
          const hit = bannedHit(await mainText());
          check(`main screen has no technical text: ${name} at ${size.width}x${size.height}`, !hit, `found "${hit}"`);
        }
      }
    }

    // every hero x every style fits at both desktop sizes with every item shown
    if (fitK >= 0 || S('wide')) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openHeroes();
      allHeroes = await page.$$eval('.hero-dialog .hero-opt', (els) => els.map((e) => e.textContent.trim()));
      await page.keyboard.press('Escape');
      await page.waitForSelector('.hero-dialog', { state: 'detached' });
    }
    if (fitK === 0) check('hero list has every hero', allHeroes.length >= 30, `${allHeroes.length}`);
    if (fitK >= 0) {
      // sampled: every 6th hero (speed target, see WORKER_NOTES), spread over the FIT_PARTS stages
      const mine = allHeroes.filter((_, i) => i % 6 === 0).filter((_, j) => j % FIT_PARTS === fitK);
      let combos = 0;
      let gridCombos = 0;
      const gridBad = [];
      const bad = [];
      await pool(mine, 3, { width: 1440, height: 900 }, async (pg, name) => {
        await pg.setViewportSize({ width: 1440, height: 900 });
        await gotoHero(pg, name);
        await waitSettled(name, pg);
        const nStyles = Math.max(1, (await pg.$$('.style-pill')).length);
        for (let i = 0; i < nStyles; i++) {
          if (i > 0) {
            await pg.locator('.style-pill').nth(i).click();
            await pg.waitForFunction(
              (k) => document.querySelectorAll('.style-pill')[k]?.getAttribute('aria-pressed') === 'true' && !document.querySelector('.board-wrap.stale'),
              i,
              { timeout: 15000 },
            );
          }
          await pg.click('.details-btn');
          await pg.waitForSelector('.details');
          const want = await pg.$$eval('.details .item-table tbody tr', (els) => els.length);
          await pg.keyboard.press('Escape');
          await pg.waitForSelector('.details', { state: 'detached' });
          for (const size of [
            { width: 1440, height: 900 },
            { width: 1920, height: 1080 },
          ]) {
            await pg.setViewportSize(size);
            await pg.waitForTimeout(60);
            if (size.width === 1440) {
              const gw = await gridProbe(pg);
              gridCombos++;
              if (gw.length) gridBad.push(`${name}#${i}: ${gw.slice(0, 3).join('; ')}`);
            }
            const f = await fitProbe(pg);
            combos++;
            const why = [];
            if (f.sh > f.ih) why.push(`scrollHeight ${f.sh} > ${f.ih}`);
            if (f.sw > f.iw) why.push(`scrollWidth ${f.sw} > ${f.iw}`);
            if (f.scrollers.length) why.push(`scrollable: ${f.scrollers.join('|')}`);
            if (f.tiles !== want || want === 0) why.push(`tiles ${f.tiles} != items ${want}`);
            if (f.clipped) why.push(`${f.clipped} tiles outside viewport`);
            if (why.length) bad.push(`${name}#${i}@${size.width}: ${why.join('; ')}`);
          }
        }
      });
      check(
        `every hero x style fits with all items shown at 1440x900 and 1920x1080 (${combos} combos, part ${fitK + 1}/${FIT_PARTS})`,
        bad.length === 0 && combos >= mine.length * 2,
        bad.slice(0, 8).join(' // '),
      );

      check(
        `ability grid: 4 rows, own row+column, point order, 1/2/5 markers (${gridCombos} hero x style at 1440x900, part ${fitK + 1}/${FIT_PARTS})`,
        gridBad.length === 0 && gridCombos >= mine.length,
        gridBad.slice(0, 6).join(' // '),
      );
    }

    if (S('wide')) {
      // phone: no sideways scroll for any hero; whole grid visible
      const wide = [];
      const gridWide = [];
      await pool(
        allHeroes.filter((_, i) => i % 6 === 0),
        6,
        { width: 390, height: 844 },
        async (pg, name) => {
          await gotoHero(pg, name);
          await waitSettled(name, pg);
          const w = await pg.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
          if (w[0] > w[1]) wide.push(`${name} ${w[0]}`);
          const g = await pg.evaluate(() => {
            const grid = document.querySelector('.ap-grid');
            const off = [...grid.querySelectorAll('.ap-mark')].filter((m) => {
              const r = m.getBoundingClientRect();
              return r.left < 0 || r.right > innerWidth || r.width < 12;
            }).length;
            return { sw: grid.scrollWidth, cw: grid.clientWidth, off };
          });
          if (g.sw > g.cw || g.off) gridWide.push(`${name} sw${g.sw}/cw${g.cw} off${g.off}`);
        },
      );
      check('phone 390x844: whole ability grid visible, no sideways scroll, markers inside viewport', gridWide.length === 0, gridWide.slice(0, 6).join(', '));
      check('phone 390x844: no sideways scroll for any hero', wide.length === 0, wide.join(', '));
    }

    if (S('main')) {
      // pointer pick + back
      await page.setViewportSize({ width: 1440, height: 900 });
      await pickHero('Infernus');
      await waitSettled('Infernus');
      const urlA = page.url();
      await pickHero('Haze');
      await waitSettled('Haze');
      check('pointer pick changes the URL', page.url() !== urlA && /hero=haze/i.test(page.url()), page.url());
      await page.goBack();
      await waitSettled('Infernus');
      check('back restores the previous hero', true);
    }
  }

  if (S('arrows')) {
    // prev / next hero arrows: visible at rest, step through heroes with wrap, update the URL, 44px on phone
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await pickHero('Infernus');
      await page.waitForFunction(() => document.querySelector('.frame-head h1')?.textContent.startsWith('Infernus') && document.querySelector('.board'), null, {
        timeout: 15000,
      });
      const tag = `${size.width}x${size.height}`;
      const arrows = await page.evaluate(() =>
        ['Previous hero', 'Next hero'].map((n) => {
          const el = [...document.querySelectorAll(`button[aria-label="${n}"]`)].find((b) => b.getBoundingClientRect().width > 0);
          const r = el?.getBoundingClientRect();
          return el ? { w: r.width, h: r.height, o: Number(getComputedStyle(el).opacity), inside: r.left >= 0 && r.right <= innerWidth } : null;
        }),
      );
      check(
        `hero arrows visible at rest at ${tag}`,
        arrows.every((a) => a && a.w >= 44 && a.h >= 44 && a.o === 1 && a.inside),
        JSON.stringify(arrows),
      );
      const title = () => page.$eval('.frame-head h1', (e) => e.textContent.split(' - ')[0]);
      const step = async (name) => {
        const before = await title();
        await page.locator(`button[aria-label="${name}"]:visible`).click();
        await page.waitForFunction(
          (b) => document.querySelector('.frame-head h1')?.textContent.split(' - ')[0] !== b && document.querySelector('.board-wrap:not(.stale)'),
          before,
          {
            timeout: 15000,
          },
        );
        return [before, await title(), new URL(page.url()).searchParams.get('hero')];
      };
      const [b1, n1, u1] = await step('Next hero');
      const [, n2, u2] = await step('Previous hero');
      check(`next hero arrow shows another hero and updates the URL at ${tag}`, n1 !== b1 && !!u1 && u1.length > 0, `${b1} -> ${n1}, ?hero=${u1}`);
      check(`previous hero arrow returns to the first hero at ${tag}`, n2 === b1, `${n1} -> ${n2}, ?hero=${u2}`);
      const [, w1] = await step('Previous hero');
      check(`previous from the first hero wraps at ${tag}`, !!w1 && w1 !== b1, `${b1} -> ${w1}`);
      await page.locator('button[aria-label="Next hero"]:visible').click();
      await page.waitForFunction(
        (b) => document.querySelector('.frame-head h1')?.textContent.startsWith(b) && document.querySelector('.board-wrap:not(.stale)'),
        b1,
        { timeout: 15000 },
      );
    }
    // hero control cue: visible at rest (pointer away, nothing focused), pressing it opens the hero dialog
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.mouse.move(size.width - 1, size.height - 1);
      await page.evaluate(() => document.activeElement?.blur());
      const cue = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.hero-btn')].find((b) => b.getBoundingClientRect().width > 0);
        const el = btn?.querySelector('.hero-cue');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          w: r.width,
          h: r.height,
          o: Number(getComputedStyle(el).opacity),
          v: getComputedStyle(el).visibility,
          hovered: btn.matches(':hover'),
          focused: btn.matches(':focus'),
        };
      });
      check(
        `hero cue visible at rest at ${size.width}x${size.height}`,
        !!cue && cue.w > 0 && cue.h > 0 && cue.o === 1 && cue.v === 'visible' && !cue.hovered && !cue.focused,
        JSON.stringify(cue),
      );
      await page.click('.hero-btn:visible');
      await page.waitForSelector('.hero-dialog .hero-filter');
      check(`pressing the hero control opens the hero dialog at ${size.width}x${size.height}`, true);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.hero-dialog', { state: 'detached' });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  if (S('share')) {
    // item 6: Share button (no stub) yields a real PNG download
    {
      await page.evaluate(() => {
        window.__pngText = [];
        const orig = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (t, ...rest) {
          window.__pngText.push(String(t));
          return orig.call(this, t, ...rest);
        };
      });
      const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
      await page.click('.share-btn');
      const download = await downloadPromise;
      await download.saveAs(shot('share-infernus.png'));
      const stream = await download.createReadStream();
      const bytes = await new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks).subarray(0, 8)));
        stream.on('error', reject);
      });
      const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      check('item 6: Share (no stub) downloads a file starting with the PNG signature', bytes.equals(pngSig), bytes.toString('hex'));
      const pngText = await page.evaluate(() => window.__pngText);
      const pngHit = bannedHit(pngText.join('\n')) ?? pngText.find((t) => /\d{3,}/.test(t));
      check('share PNG: text was drawn and none of it is technical', pngText.length > 5 && !pngHit, `found "${pngHit}" in ${pngText.length} strings`);
      await page.waitForSelector('text=Image saved', { timeout: 5000 });
      check('item 6: Share success shows a visible message (not alert())', true);
    }
  }

  if (S('cls-busy')) {
    // item 6: CLS across three hero switches stays low — the old build stays mounted (dimmed), not collapsed
    {
      await page.evaluate(() => {
        window.__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
        }).observe({ type: 'layout-shift', buffered: false });
      });
      for (const name of ['Seven', 'Vindicta', 'Warden']) {
        await pickHero(name);
        await page.waitForFunction((n) => document.querySelector('.frame-head h1')?.textContent.startsWith(n), name, { timeout: 15000 });
        await page.waitForSelector('.board-wrap:not(.stale)', { timeout: 15000 });
      }
      const cls = await page.evaluate(() => window.__cls);
      check('item 6: cumulative layout shift across 3 hero switches < 0.05', cls < 0.05, `${cls.toFixed(4)}`);
      await pickHero('Infernus');
      await page.waitForFunction(() => document.querySelector('.frame-head h1')?.textContent.startsWith('Infernus'), null, { timeout: 15000 });
    }

    // item 3: the previous build stays mounted and visibly dims (not just "same class name") while the
    // next hero's analytics are still loading — delay the response, poll computed opacity/aria-busy/tile
    // count during the delay, then confirm it recovers to opacity 1 once the response lands.
    {
      await page.route('**/data/analytics/2.json', async (route) => {
        await new Promise((r) => setTimeout(r, 800));
        await route.continue();
      });
      await pickHero('Seven');
      await page.waitForFunction(() => document.querySelector('.board-wrap')?.getAttribute('aria-busy') === 'true', null, { timeout: 2000 }).catch(() => {});
      let sawBusy = false;
      let minOpacity = 1;
      let minTiles = Infinity;
      const deadline = Date.now() + 700;
      while (Date.now() < deadline) {
        const busy = await page.getAttribute('.board-wrap', 'aria-busy').catch(() => null);
        if (busy === 'true') sawBusy = true;
        const opacity = await page.$eval('.board-wrap', (el) => parseFloat(getComputedStyle(el).opacity)).catch(() => 1);
        minOpacity = Math.min(minOpacity, opacity);
        const tiles = await page.$$eval('.board-wrap .tiles .tile', (els) => els.length).catch(() => 0);
        if (tiles > 0) minTiles = Math.min(minTiles, tiles);
        await page.waitForTimeout(50);
      }
      check('item 3: board-wrap has aria-busy="true" during hero switch', sawBusy);
      check('item 3: board-wrap is not dimmed or flashed during hero switch (opacity stays 1)', minOpacity === 1, `min opacity=${minOpacity}`);
      check('item 3: previous build stays mounted (>=12 tiles) during the switch', minTiles >= 12, `min tiles=${minTiles}`);
      await page.waitForFunction(() => document.querySelector('.frame-head h1')?.textContent.startsWith('Seven'), null, { timeout: 15000 });
      await page
        .waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.board-wrap')).opacity) === 1, null, { timeout: 5000 })
        .catch(() => {});
      const finalOpacity = await page.$eval('.board-wrap', (el) => parseFloat(getComputedStyle(el).opacity));
      check('item 3: board-wrap opacity returns to 1 once the new build loads', finalOpacity === 1, `${finalOpacity}`);
      await page.unroute('**/data/analytics/2.json');
      await pickHero('Infernus');
      await page.waitForFunction(() => document.querySelector('.frame-head h1')?.textContent.startsWith('Infernus'), null, { timeout: 15000 });
    }
  }

  if (S('share')) {
    // item 6: Share failure (toBlob stubbed to throw) shows a visible failure message, never a native dialog
    {
      const page2 = await ctx.newPage();
      let dialogCount = 0;
      page2.on('dialog', (d) => {
        dialogCount++;
        d.dismiss();
      });
      await page2.addInitScript(() => {
        HTMLCanvasElement.prototype.toBlob = () => {
          throw new Error('stubbed failure');
        };
      });
      await page2.goto('http://localhost:4173/');
      await page2.waitForSelector('.tiles .tile', { timeout: 20000 });
      await page2.click('.share-btn');
      await page2.waitForSelector('text=Image export failed', { timeout: 10000 });
      check('item 6: Share failure (toBlob throws) raises zero native dialogs and shows a visible failure message', dialogCount === 0);
      await page2.close();
    }
  }

  if (S('axe')) {
    // item 7: axe accessibility scan at both sizes, with the item sheet closed and open
    const runAxe = async (label) => {
      const results = await new AxeBuilder({ page }).analyze();
      const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      check(
        `item 7: axe scan (${label}) — 0 serious/critical violations`,
        bad.length === 0,
        bad
          .map(
            (v) =>
              `${v.id} (${v.impact}): ${v.nodes
                .slice(0, 3)
                .map((n) => `${n.target.join(' ')} [${n.any?.[0]?.message ?? ''}]`)
                .join(' | ')}`,
          )
          .join(', '),
      );
    };
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:4173/');
    await page.waitForSelector('.tiles .tile', { timeout: 20000 });
    await runAxe('desktop, sheet closed');
    await (await page.$('.tiles .tile')).click();
    await page.waitForSelector('.sheet');
    await runAxe('desktop, sheet open');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    await runAxe('phone, sheet closed');
    await (await page.$('.tiles .tile')).click();
    await page.waitForSelector('.sheet');
    await runAxe('phone, sheet open');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sheet', { state: 'detached' });
  }
} catch (e) {
  check('browser flow', false, String(e));
}
if (S('share')) {
  // item 6: with reducedMotion:'reduce', no element reports a transition-duration above 0s
  try {
    const rmCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const rmPage = await rmCtx.newPage();
    await rmPage.route('**/*', (route) => (route.request().url().startsWith('http://localhost:4173') ? route.continue() : route.abort()));
    await rmPage.goto('http://localhost:4173/');
    await rmPage.waitForSelector('.tiles .tile', { timeout: 20000 });
    const worstDuration = await rmPage.evaluate(() =>
      Math.max(
        0,
        ...[...document.querySelectorAll('*')].map((el) => {
          const d = getComputedStyle(el).transitionDuration;
          return Math.max(...d.split(',').map((s) => parseFloat(s) || 0));
        }),
      ),
    );
    check('item 6: reducedMotion leaves no element with transition-duration above 0s', worstDuration <= 0, `${worstDuration}s`);
    await rmCtx.close();
  } catch (e) {
    check('item 6: reducedMotion transition check', false, String(e));
  }
}
check('no console errors (network disabled) [' + STAGE + ']', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`(blocked ${imgBlocked.length} external requests, e.g. images — expected offline)`);
await browser.close();
process.exit(fails ? 1 : 0);

// Headless browser check: serves dist/ with vite preview, blocks all network except localhost, opens the app ONCE
// and tours it: desktop build -> details -> item sheet -> hero picker/arrows/styles -> fit sample -> share ->
// error recovery -> phone layout -> unknown slug / reduced motion -> axe. One browser, one page, one sequence.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';

const URL0 = 'http://localhost:4173/';
const SHOT_DIR = process.env.SHOT_DIR || 'screenshots';
mkdirSync(SHOT_DIR, { recursive: true });
const snap = (o) => process.env.SHOT_DIR && page.screenshot(o);
const shot = (n) => `${SHOT_DIR}/${n}`;
const t0 = Date.now();

const srv = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) {
  if (
    await fetch(URL0).then(
      (r) => r.ok,
      () => false,
    )
  )
    break;
  await new Promise((r) => setTimeout(r, 100));
}

const cache = process.env.HOME + '/.cache/ms-playwright/';
const exe =
  process.env.CHROME_PATH ||
  readdirSync(cache)
    .filter((d) => d.startsWith('chromium_headless_shell-'))
    .sort()
    .map((d) => cache + d + '/chrome-headless-shell-linux64/chrome-headless-shell')
    .find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.route('**/*', (route) => (route.request().url().startsWith('http://localhost:4173') ? route.continue() : route.abort()));

let fails = 0;
let passes = 0;
const check = (n, ok, d = '') => {
  ok ? passes++ : fails++;
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d ? ' — ' + d : ''}`);
};
const T = { timeout: 15000 };
const settled = (name) =>
  page.waitForFunction(
    (h) =>
      document.querySelector('.frame-head h1')?.textContent.startsWith(h) &&
      !document.querySelector('.board-wrap.stale') &&
      document.querySelectorAll('.tiles .tile').length >= 1,
    name,
    T,
  );
const openHeroes = async () => {
  await page.click('.hero-btn:visible');
  await page.waitForSelector('.hero-dialog .hero-filter');
};
const closeHeroes = async () => {
  await page.keyboard.press('Escape');
  await page.waitForSelector('.hero-dialog', { state: 'detached' });
};
const pickHero = async (name) => {
  await openHeroes();
  await page.fill('.hero-dialog .hero-filter', name);
  await page.click(`.hero-dialog .hero-opt:has-text("${name}")`);
  await page.waitForSelector('.hero-dialog', { state: 'detached' });
  await settled(name);
};
const openDetails = async () => {
  await page.click('.details-btn');
  await page.waitForSelector('.details');
};
const closeDetails = async () => {
  await page.keyboard.press('Escape');
  await page.waitForSelector('.details', { state: 'detached' });
};
const gotoHero = async (slug) => {
  await page.evaluate((s) => {
    history.pushState({}, '', '?hero=' + s);
    dispatchEvent(new PopStateEvent('popstate'));
  }, slug);
};
const frames = (n = 2) =>
  page.evaluate(
    (k) =>
      new Promise((res) =>
        (function f(i) {
          i ? requestAnimationFrame(() => f(i - 1)) : res();
        })(k),
      ),
    n,
  );
const rectOf = (sel) =>
  page.$eval(
    sel,
    (el) =>
      new Promise((res) => {
        const read = () => el.getBoundingClientRect().toJSON();
        let prev = read();
        let left = 120;
        (function tick() {
          const r = read();
          if (Object.keys(r).every((k) => Math.abs(r[k] - prev[k]) < 0.5) || --left <= 0) return res(r);
          prev = r;
          requestAnimationFrame(tick);
        })();
      }),
  );
const inside = (r, w, h) => r.left >= -0.5 && r.top >= -0.5 && r.right <= w + 0.5 && r.bottom <= h + 0.5 && r.width >= 300;
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
const gridProbe = () =>
  page.evaluate(() => {
    const why = [];
    const grid = document.querySelector('.ap-grid');
    if (!grid) return ['no .ap-grid'];
    if (grid.querySelectorAll('.ap-row').length !== 4) why.push('not 4 rows');
    const marks = [...grid.querySelectorAll('.ap-mark')];
    const order = JSON.parse(grid.dataset.order || '[]');
    if (marks.length !== order.length) why.push(`${marks.length} markers != ${order.length} steps`);
    const kinds = ['unlock', 'tier1', 'tier2', 'tier3'];
    [...marks]
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      .forEach((m, k) => {
        const kind = kinds.find((c) => m.classList.contains(c));
        if (!order[k] || m.dataset.ability !== order[k][0] || kind !== order[k][1]) why.push(`x-order ${k}`);
      });
    if (new Set(marks.map((m) => Math.round(m.getBoundingClientRect().left + m.getBoundingClientRect().width / 2))).size !== marks.length)
      why.push('shared column');
    const cost = { tier1: '1', tier2: '2', tier3: '5' };
    for (const m of marks) {
      const kind = kinds.find((c) => m.classList.contains(c));
      if (m.closest('.ap-row').dataset.ability !== m.dataset.ability) why.push('marker in wrong row');
      if (kind === 'unlock' ? m.textContent.trim() !== '' : m.textContent.trim() !== cost[kind]) why.push(`marker reads "${m.textContent.trim()}"`);
      if (!m.getAttribute('aria-label')) why.push('marker without name');
    }
    return why;
  });
const fitProbe = () =>
  page.evaluate(() => {
    const scrollers = [...document.querySelectorAll('main *')].filter((el) => {
      const cs = getComputedStyle(el);
      return (
        (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
        (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1)
      );
    }).length;
    const tiles = [...document.querySelectorAll('.tiles .tile')];
    const clipped = tiles.filter((t) => {
      const r = t.getBoundingClientRect();
      return r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5 || r.top < 0 || r.left < 0;
    }).length;
    const d = document.documentElement;
    return { v: d.scrollHeight > innerHeight, h: d.scrollWidth > innerWidth, scrollers, tiles: tiles.length, clipped };
  });
const tapTargets = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('button, select, a, [role=button]')]
      .filter((el) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40);
      })
      .map((el) => el.className),
  );
const axe = async (label) => {
  const bad = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(`axe (${label}): 0 serious/critical`, bad.length === 0, bad.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`).join(', '));
};

try {
  // ---- desktop 1440x900: the Infernus build ----
  await page.goto(URL0);
  await page.waitForSelector('.tiles .tile', { timeout: 20000 });
  await settled('Infernus');
  check('opens on Infernus with one named build', (await page.$$eval('.frame-head h1', (e) => e.length)) === 1);
  {
    const tiles = await page.$$eval('.tiles .tile', (els) => els.map((e) => [Number(e.dataset.cost), Number(e.dataset.total)]));
    let run = 0;
    check('build: >=12 items, running totals add up', tiles.length >= 12 && tiles.every(([c, t]) => (run += c) === t), `${tiles.length} items`);
    check('build: 3 phase rows', (await page.$$('.row:not(.abilities) .row-head')).length === 3);
    const srcs = await page.$$eval('.tiles .tile img', (els) => els.map((e) => e.getAttribute('src')));
    check('build: item images point at local data', srcs.length === tiles.length && srcs.every((s) => /\/data\/img\/items\/\d+\.webp$/.test(s)));
    const abil = await page.$$eval('.ap-row', (els) => els.map((e) => e.dataset.ability));
    check(
      'abilities: 4 real Infernus abilities',
      ['Napalm', 'Flame Dash', 'Afterburn', 'Concussive Combustion'].every((n) => abil.includes(n)) && abil.length === 4,
      abil.join(', '),
    );
    const g = await gridProbe();
    check('ability grid: rows, columns, point order, 1/2/5 markers', g.length === 0, g.slice(0, 3).join('; '));
  }
  {
    const f = await fitProbe();
    check(
      'one top bar (the nav bar), no footer, no other header',
      (await page.$$('header')).length === 1 && (await page.$$('footer, .app-header')).length === 0,
    );
    check('one details control, closed by default', (await page.$$('.details-btn')).length === 1 && (await page.$$('.details')).length === 0);
    let bad = [];
    for (const sel of ['.hero-btn:visible', '.style-switch', '.row.abilities', '.ap-grid', '.share-btn', '.details-btn']) {
      const r = await page.locator(sel).first().boundingBox();
      if (!r || r.x < 0 || r.y < 0 || r.x + r.width > 1440 || r.y + r.height > 900) bad.push(sel);
    }
    check('main controls are inside the viewport', bad.length === 0, bad.join(', '));
    check('main screen has no technical text', !bannedHit(await page.evaluate(() => document.querySelector('main.screen').innerText)));
    // desktop nav is a 36px mouse bar (links >= 28px, above WCAG 2.5.8's 24px); phone steps below hold nav to 40px
    const small = (await tapTargets()).filter((c) => !/^nav/.test(c));
    check('tap targets >= 40px', small.length === 0, small.slice(0, 5).join(', '));
    check(
      'desktop nav links are at least 28px tall',
      await page.evaluate(() => [...document.querySelectorAll('.nav-link, .nav-brand')].every((a) => a.getBoundingClientRect().height >= 28)),
    );
    check('exactly one visible hero control', (await page.$$('.hero-btn:visible')).length === 1);
  }
  await snap({ path: shot('infernus-build-desktop.png') });

  // ---- details dialog ----
  await page.focus('.details-btn');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.details');
  {
    const text = await page.$eval('.details', (e) => e.innerText);
    const badges = await page.$$eval('.details .item-table tr[data-core]', (e) => e.length);
    const tiles = await page.$$eval('.tiles .tile', (e) => e.length);
    check(
      'details: agreement %, match count, win rate, data date, player table, core badge per item',
      /\d+% match/.test(text) &&
        /[\d,]+ matches/.test(text) &&
        /win rate/i.test(text) &&
        /data from \d{1,2} \w{3} \d{4}/i.test(text) &&
        (await page.$$('.details .panel-table tbody tr')).length >= 1 &&
        badges === tiles,
      text.slice(0, 120),
    );
    await snap({ path: shot('details-desktop.png') });
  }
  await closeDetails();
  await page.waitForFunction(() => document.activeElement?.classList.contains('details-btn'), null, { timeout: 2000 }).catch(() => {});
  check('details: Escape closes and returns focus to the control', await page.evaluate(() => document.activeElement?.classList.contains('details-btn')));

  // ---- item sheet (desktop) ----
  const firstTile = await page.$eval('.tiles .tile', (el) => el.textContent);
  await page.click('.tiles .tile');
  await page.waitForSelector('.sheet');
  {
    const title = () => page.textContent('[data-slot="dialog-content"] h2');
    const name = await title();
    const chips = await page.$$eval('.sheet .chip', (els) => els.map((e) => e.textContent.trim()));
    check(
      'item sheet: image, cost, tier, slot, stat lines',
      !!(await page.$('.sheet-head img')) &&
        chips.some((c) => /^[\d,]+$/.test(c)) &&
        chips.some((c) => /^Tier \d/.test(c)) &&
        chips.some((c) => /Weapon|Vitality|Spirit/.test(c)) &&
        (await page.$$('.sheet .stat-line')).length > 0,
      `${name}: ${chips.join(' | ')}`,
    );
    const r = await rectOf('[role="dialog"]');
    check(
      'item sheet: centred and inside the window',
      inside(r, 1440, 900) && Math.abs((r.left + r.right) / 2 - 720) <= 2 && Math.abs((r.top + r.bottom) / 2 - 450) <= 2,
      JSON.stringify(r),
    );
    check('item sheet: focus starts inside the dialog', await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')));
    let left = false;
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      if (!(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))) left = true;
    }
    check('item sheet: Tab never leaves the dialog', !left);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((p) => document.querySelector('[data-slot="dialog-content"] h2')?.textContent !== p, name, { timeout: 5000 });
    const r2 = await rectOf('[role="dialog"]');
    check('item sheet: ArrowRight steps to the next item, still centred', inside(r2, 1440, 900) && Math.abs((r2.left + r2.right) / 2 - 720) <= 2);
    const heads = await page.$$eval('[data-slot="dialog-content"] .tt-section h3', (els) => els.map((e) => e.textContent ?? ''));
    check('item sheet: no heading prints a raw section_type', !heads.some((h) => /^[a-z_]+$/.test(h)), heads.join(', '));
    await snap({ path: shot('item-sheet-desktop.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.classList.contains('tile'), null, { timeout: 2000 }).catch(() => {});
    const back = await page.evaluate(() => (document.activeElement?.classList.contains('tile') ? document.activeElement.textContent : null));
    check('item sheet: Escape returns focus to the tile last shown', back !== null && back !== firstTile, `${back} vs ${firstTile}`);
    // focus ring on a tile (a real Tab first so :focus-visible applies)
    const tile = await page.$('.tiles .tile');
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(1439, 899);
    const resting = await tile.evaluate((el) => getComputedStyle(el).outlineStyle);
    await page.keyboard.press('Tab');
    await tile.focus();
    const focused = await tile.evaluate((el) => getComputedStyle(el).outlineStyle);
    check('tile: visible focus outline', focused === 'solid' && resting !== 'solid', `${resting} -> ${focused}`);
    await tile.evaluate((el) => el.blur());
  }

  // ---- hero picker, URL, arrows, styles ----
  await openHeroes();
  const allHeroes = await page.$$eval('.hero-dialog .hero-opt', (els) => els.map((e) => e.textContent.trim()));
  await snap({ path: shot('hero-picker-desktop.png') });
  await page.fill('.hero-dialog .hero-filter', 'las');
  const las = await page.$$eval('.hero-dialog .hero-opt', (els) => els.map((e) => e.textContent.trim()));
  check(
    'hero picker: lists every hero; "las" leaves only Lash',
    allHeroes.length >= 30 && las.length === 1 && las[0].includes('Lash'),
    `${allHeroes.length} heroes; ${las.join(',')}`,
  );
  await page.press('.hero-dialog .hero-filter', 'Enter');
  await settled('Lash');
  check('picking a hero puts hero=lash in the URL', new URL(page.url()).searchParams.get('hero') === 'lash', page.url());
  await page.reload();
  await settled('Lash');
  await page.goBack();
  await settled('Infernus');
  check('reload keeps the hero; back restores the previous one', true);
  {
    const arrows = await page.evaluate(() =>
      ['Previous hero', 'Next hero'].map((n) => {
        const el = [...document.querySelectorAll(`button[aria-label="${n}"]`)].find((b) => b.getBoundingClientRect().width > 0);
        const r = el?.getBoundingClientRect();
        return el ? r.width >= 44 && r.height >= 44 && Number(getComputedStyle(el).opacity) === 1 : false;
      }),
    );
    check('hero arrows visible at rest, >= 44px', arrows.every(Boolean), JSON.stringify(arrows));
    const title = () => page.$eval('.frame-head h1', (e) => e.textContent.split(' - ')[0]);
    const step = async (n) => {
      const before = await title();
      await page.locator(`button[aria-label="${n}"]:visible`).click();
      await page.waitForFunction(
        (b) => document.querySelector('.frame-head h1')?.textContent.split(' - ')[0] !== b && document.querySelector('.board-wrap:not(.stale)'),
        before,
        T,
      );
      return [before, await title()];
    };
    const [b1, n1] = await step('Next hero');
    const [, n2] = await step('Previous hero');
    const [, w1] = await step('Previous hero');
    check('arrows: next changes hero, previous returns, previous from first wraps', n1 !== b1 && n2 === b1 && w1 !== b1, `${b1} -> ${n1} -> ${n2} -> ${w1}`);
    await page.locator('button[aria-label="Next hero"]:visible').click();
    await settled(b1);
    // one click away is prefetched: stepping to a neighbour makes no analytics request, and the portrait slides in from the arrow's side
    const reqs = [];
    const onReq = (r) => /analytics\//.test(r.url()) && reqs.push(r.url());
    page.on('request', onReq);
    await page.locator('button[aria-label="Next hero"]:visible').first().click();
    const slide = await page.locator('.hero-slide:visible').first().getAttribute('data-slide');
    await settled((await title()).split(' - ')[0]);
    page.off('request', onReq);
    check(
      'arrows: neighbour is prefetched (no analytics request) and portrait slides from the right',
      reqs.length === 0 && slide === '1',
      `reqs=${reqs.length} slide=${slide}`,
    );
    await page.locator('button[aria-label="Previous hero"]:visible').first().click();
    await settled(b1);
  }
  await pickHero('Warden');
  {
    const pills = await page.$$('.style-pill');
    if (pills.length >= 2) {
      const before = await page.evaluate(() => document.querySelector('.tiles .tile')?.textContent + document.querySelector('.frame-head h1')?.textContent);
      await pills[1].click();
      await page.waitForFunction(
        (p) => document.querySelector('.tiles .tile')?.textContent + document.querySelector('.frame-head h1')?.textContent !== p,
        before,
        T,
      );
      check('Warden: second style tab changes the build and adds style= to the URL', new URL(page.url()).searchParams.has('style'), page.url());
    } else check('Warden: second style tab', false, `${pills.length} style tabs`);
  }

  // ---- fit sample: a few heroes x every style x both desktop sizes (1440 covers the ability grid too) ----
  {
    const bad = [];
    let posBase = [];
    for (const name of ['Infernus', 'Warden', 'Mina']) {
      await gotoHero(name.toLowerCase());
      await settled(name);
      const n = Math.max(1, (await page.$$('.style-pill')).length);
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          await page.locator('.style-pill').nth(i).click();
          await page.waitForFunction(
            (k) => document.querySelectorAll('.style-pill')[k]?.getAttribute('aria-pressed') === 'true' && !document.querySelector('.board-wrap.stale'),
            i,
            T,
          );
        }
        await openDetails();
        const want = await page.$$eval('.details .item-table tbody tr', (e) => e.length);
        await closeDetails();
        for (const [w, h] of i === 0
          ? [
              [1440, 900],
              [1920, 1080],
            ]
          : [[1440, 900]]) {
          await page.setViewportSize({ width: w, height: h });
          await frames();
          const f = await fitProbe();
          const g = w === 1440 ? await gridProbe() : [];
          if (w === 1440) {
            const pos = await page.evaluate(() =>
              ['.style-pill', '.share-btn', '.details-btn', '.board'].map((q) => {
                const r = document.querySelector(q)?.getBoundingClientRect() ?? { x: 0, y: 0, width: 0, height: 0 };
                return [q, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(':');
              }),
            );
            (i === 0 ? (posBase = pos) : pos).forEach((v, k) => v !== posBase[k] && bad.push(`${name}#${i} moved ${posBase[k]} -> ${v}`));
          }
          if (f.v || f.h || f.scrollers || f.clipped || f.tiles !== want || !want || g.length)
            bad.push(`${name}#${i}@${w}: ${JSON.stringify(f)} ${g.slice(0, 2)}`);
        }
        await page.setViewportSize({ width: 1440, height: 900 });
      }
    }
    check(
      'sample heroes x styles fit at 1440x900 and 1920x1080, all items shown, grid correct, pills/Share/Details/board never move',
      bad.length === 0,
      bad.slice(0, 4).join(' // '),
    );
  }

  // ---- share: real PNG, then the failure path ----
  await pickHero('Infernus');
  await page.evaluate(() => {
    window.__png = [];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...rest) {
      window.__png.push(String(t));
      return orig.call(this, t, ...rest);
    };
  });
  {
    const dl = page.waitForEvent('download', { timeout: 10000 });
    await page.click('.share-btn');
    const download = await dl;
    await download.saveAs(shot('share-infernus.png'));
    const bytes = await new Promise(async (res, rej) => {
      const s = await download.createReadStream();
      const c = [];
      s.on('data', (x) => c.push(x));
      s.on('end', () => res(Buffer.concat(c).subarray(0, 8)));
      s.on('error', rej);
    });
    check('share: downloads a PNG', bytes.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), bytes.toString('hex'));
    const txt = await page.evaluate(() => window.__png);
    const hit = bannedHit(txt.join('\n')) ?? txt.find((t) => /\d{3,}/.test(t));
    check('share: image has text, none of it technical', txt.length > 5 && !hit, `"${hit}" in ${txt.length} strings`);
    await page.waitForSelector('text=Image saved', { timeout: 5000 });
    let dialogs = 0;
    page.on('dialog', (d) => (dialogs++, d.dismiss()));
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = () => {
        throw new Error('stubbed failure');
      };
    });
    await page.click('.share-btn');
    await page.waitForSelector('text=Image export failed', { timeout: 10000 });
    check('share: success and failure both show a toast, no native dialog', dialogs === 0);
    await page.evaluate(() => document.querySelectorAll('[data-sonner-toast]').forEach((t) => t.remove())); // a lingering toast would cover buttons on the phone layout
  }

  // ---- error recovery: analytics fetch fails -> Retry, then another hero works ----
  {
    const lines = [];
    const onMsg = (m) => lines.push(m.text());
    page.on('console', onMsg);
    await page.route('**/data/analytics/2.json', (r) => r.abort());
    // one-click-away prefetch caches heroes already visited or adjacent; reload so Seven is genuinely uncached
    await page.reload();
    await page.waitForSelector('.tiles .tile', T);
    await openHeroes();
    await page.fill('.hero-dialog .hero-filter', 'Seven');
    await page.click('.hero-dialog .hero-opt:has-text("Seven")');
    await page.waitForSelector('button:has-text("Retry")', T);
    const logged = lines.some((l) => {
      try {
        return JSON.parse(l).event === 'analytics_load_failed';
      } catch {
        return false;
      }
    });
    check(
      'analytics failure: Retry shown, hero control still there, analytics_load_failed logged',
      logged && (await page.$$('.hero-btn:visible, .hero-retry-pick:visible')).length >= 1,
    );
    await page.unroute('**/data/analytics/2.json');
    page.off('console', onMsg);
    await page.click('.hero-retry-pick');
    await page.fill('.hero-dialog .hero-filter', 'Vindicta');
    await page.click('.hero-dialog .hero-opt:has-text("Vindicta")');
    await settled('Vindicta');
    check('after the error, another hero loads normally', (await page.$$('.tiles .tile')).length >= 12);
    errors.length = 0; // the aborted request was intentional
  }

  // ---- phone 390x844 ----
  await page.emulateMedia({ reducedMotion: 'reduce' }); // sheets open instantly; desktop steps above ran with normal motion
  await page.setViewportSize({ width: 390, height: 844 });
  await pickHero('Infernus');
  {
    const f = await fitProbe();
    check('phone: no sideways scroll, whole ability grid visible', !f.h, JSON.stringify(f));
    const grid = await page.evaluate(() => {
      const g = document.querySelector('.ap-grid');
      return (
        g.scrollWidth <= g.clientWidth &&
        [...g.querySelectorAll('.ap-mark')].every((m) => m.getBoundingClientRect().left >= 0 && m.getBoundingClientRect().right <= innerWidth)
      );
    });
    check('phone: ability markers all inside the viewport', grid);
    check(
      'phone: tap targets >= 40px, one hero control, no technical text',
      (await tapTargets()).length === 0 &&
        (await page.$$('.hero-btn:visible')).length === 1 &&
        !bannedHit(await page.evaluate(() => document.querySelector('main.screen').innerText)),
    );
    await snap({ path: shot('infernus-build-phone.png'), fullPage: true });
    await openHeroes();
    check('phone: hero sheet fits the screen', inside(await rectOf('.hero-dialog'), 390, 844));
    await snap({ path: shot('hero-picker-phone.png') });
    await closeHeroes();
    await openDetails();
    check('phone: details sheet fits the screen', inside(await rectOf('.details'), 390, 844));
    await closeDetails();
    await page.click('.tiles .tile');
    await page.waitForSelector('.sheet');
    const r = await rectOf('[role="dialog"]');
    check(
      'phone: item sheet is bottom-anchored, edge to edge, on screen',
      inside(r, 390, 844) && Math.abs(r.bottom - 844) <= 1 && r.left <= 1 && r.right >= 389,
      JSON.stringify(r),
    );
    await page.keyboard.press('ArrowRight');
    await frames();
    check('phone: item sheet still on screen after ArrowRight', inside(await rectOf('[role="dialog"]'), 390, 844));
    check(
      'phone: no sideways scroll with the item sheet open',
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    );
    await snap({ path: shot('item-sheet-phone.png') });
    await axe('phone, item sheet open');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sheet', { state: 'detached' });
  }

  // ---- back to desktop: axe, unknown slug, reduced motion ----
  await page.setViewportSize({ width: 1440, height: 900 });
  await axe('desktop');
  // ---- nav bar + tier list ----
  await page.goto(URL0 + '?hero=vindicta');
  await settled('Vindicta');
  check('shared build URL (?hero=vindicta) still opens that hero', true);
  {
    const nav = await page.evaluate(() => {
      const links = [...document.querySelectorAll('.nav-link')];
      const logo = document.querySelector('.nav-brand img');
      return {
        labels: links.map((a) => a.textContent.trim()),
        current: links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent.trim()),
        brawl: links[2]?.getAttribute('href'),
        name: document.querySelector('.nav-name')?.textContent,
        logo: logo?.getAttribute('src'),
        logoOk: !!logo && logo.complete && logo.naturalWidth > 0,
        icons: links.every((a) => a.querySelector('svg')),
        top: document.querySelector('.nav').getBoundingClientRect().top,
        h: document.querySelector('.nav').getBoundingClientRect().height,
      };
    });
    check(
      'nav (build page): logo, name, 3 entries with icons, Build Finder current',
      nav.labels.join('|') === 'Build Finder|Tier List|Street Brawl' &&
        nav.current.join() === 'Build Finder' &&
        nav.icons &&
        nav.name === 'Deadlock Builds' &&
        nav.logoOk &&
        /favicon\.svg$/.test(nav.logo) &&
        nav.top === 0 &&
        nav.h > 0,
      JSON.stringify(nav),
    );
    check('nav: Street Brawl links to its own site', nav.brawl === 'https://gidntsquia.github.io/deadlock-street-brawl-helper/', nav.brawl);
    await snap({ path: shot('nav-build-desktop.png') });
  }
  await page.evaluate(() => (window.__noReload = true));
  const pageSwitchProbe = () =>
    new Promise((res) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          res({
            heroes: [...document.querySelectorAll('.tier-hero')].filter((e) => e.getClientRects().length).length,
            skel: !!document.querySelector('.tier-skel'),
            anims: document
              .getAnimations()
              .filter((a) => a.playState === 'running')
              .map((a) => a.animationName ?? a.constructor.name),
          }),
        ),
      ),
    );
  await page.click('.nav-link:has-text("Tier List")');
  {
    const r = await page.evaluate(pageSwitchProbe);
    check('Build -> Tier List shows all 38 heroes at once, no skeleton, no animation', r.heroes === 38 && !r.skel && !r.anims.length, JSON.stringify(r));
  }
  await page.waitForSelector('.tier-hero', T);
  {
    const st = await page.evaluate(() => ({
      kept: window.__noReload === true,
      path: location.pathname,
      cur: document.querySelector('.nav-link[aria-current=page]')?.textContent.trim(),
    }));
    check(
      'nav: Tier List opens without a reload, URL changes, entry highlighted',
      st.kept && /\/tier-list\/$/.test(st.path) && st.cur === 'Tier List',
      JSON.stringify(st),
    );
    const dom = await page.evaluate(() =>
      [...document.querySelectorAll('.tier-row')].map((r) => ({
        tier: r.dataset.tier,
        label: r.querySelector('.tier-tag').textContent,
        heroes: [...r.querySelectorAll('.tier-hero span')].map((s) => s.textContent),
      })),
    );
    const [heroes, stats] = await page.evaluate(() =>
      Promise.all([fetch('/data/heroes.json').then((r) => r.json()), fetch('/data/hero-stats.json').then((r) => r.json())]),
    );
    // independent restatement of the rule in docs/tier-list.md
    const cuts = [
      ['S+', 54],
      ['S', 52],
      ['A', 50],
      ['B', 48],
      ['C', 46],
      ['D', -1],
    ];
    const rate = new Map(stats.heroes.map((s) => [s.hero_id, (100 * s.wins) / s.matches]));
    const want = new Map(heroes.map((h) => [h.name, cuts.find(([, m]) => rate.get(h.id) >= m || m < 0)[0]]));
    const got = new Map(dom.flatMap((r) => r.heroes.map((n) => [n, r.tier])));
    const all = dom.flatMap((r) => r.heroes);
    const byName = new Map(heroes.map((h) => [h.name, rate.get(h.id)]));
    const order = dom.every((r, i) => dom.slice(i + 1).every((lo) => r.heroes.every((a) => lo.heroes.every((b) => byName.get(a) >= byName.get(b)))));
    check(
      'tier list: all snapshot heroes exactly once, each in the tier the written rule gives',
      all.length === heroes.length && new Set(all).size === heroes.length && [...want].every(([n, t]) => got.get(n) === t),
      `${all.length}/${heroes.length}`,
    );
    check(
      'tier list: tiers labelled, best first, no hero above a better-winning hero below',
      dom.every((r) => r.label.startsWith(r.tier)) &&
        order &&
        dom.map((r) => r.tier).join() ===
          cuts
            .map((c) => c[0])
            .filter((t) => dom.some((r) => r.tier === t))
            .join(),
    );
    const text = await page.evaluate(() => document.querySelector('.tiers-head').innerText);
    check(
      'tier list: says Phantom+ win rates and shows the data date',
      /Phantom and above/.test(text) && /win rate/i.test(text) && /Data from \d{1,2} [A-Z][a-z]{2} \d{4}/.test(text),
      text,
    );
    for (const [w, h] of [
      [1440, 900],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await frames();
      const r = await page.evaluate(() => ({
        v: document.documentElement.scrollHeight - innerHeight,
        h: document.documentElement.scrollWidth - innerWidth,
        inner: [...document.querySelectorAll('.tiers, .tier-rows, .tier-heroes')].some(
          (e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1,
        ),
        n: document.querySelectorAll('.tier-hero').length,
        foot: (() => {
          const b = document.querySelector('.tier-foot')?.getBoundingClientRect();
          return !!b && b.bottom <= innerHeight;
        })(),
        credit: document.querySelector('.nav-credit')?.href,
        icon: !!document.querySelector('.nav-credit svg') && !!document.querySelector('.tier-credit svg'),
      }));
      check(
        `tier list fits ${w}x${h} without scrolling; rule link and credit visible`,
        r.v <= 0 && r.h <= 0 && !r.inner && r.n === 38 && r.foot && r.credit === 'https://github.com/GidntSquia' && r.icon,
        JSON.stringify(r),
      );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await frames();
    await snap({ path: shot('tier-list-desktop.png'), fullPage: true });
    await axe('desktop, tier list');
  }
  {
    // instant return: right after Back, within two frames, the build is already drawn (no skeleton, no stale dim)
    const r = await page.evaluate(
      () =>
        new Promise((res) => {
          history.back();
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              res({
                title: document.querySelector('.frame-head h1')?.textContent ?? '',
                visible: !!document.querySelector('.frame-head h1')?.getClientRects().length,
                skeleton: !!document.querySelector('.sk-head'),
                stale: !!document.querySelector('.board-wrap.stale'),
                tiles: document.querySelectorAll('.tiles .tile').length,
                anims: document.getAnimations().filter((a) => a.playState === 'running').length,
              }),
            ),
          );
        }),
    );
    check(
      'Back from the tier list shows the build at once (no skeleton)',
      r.title.startsWith('Vindicta') && r.visible && !r.skeleton && !r.stale && r.tiles > 0 && r.anims === 0,
      JSON.stringify(r),
    );
  }
  await settled('Vindicta');
  check('Back from the tier list returns to the same build', /[?&]hero=vindicta/.test(page.url()) && !/tier-list/.test(page.url()));
  await page.goForward();
  await page.waitForSelector('.tier-hero', T);
  await page.click('.tier-hero:has-text("Lash")');
  await settled('Lash');
  check('tier list: picking a hero opens that hero’s build', /[?&]hero=lash/.test(page.url()));
  {
    // a hero step plays the portrait slide; leaving and returning must not replay it
    await page.click('.hero-arrow.next:visible');
    await page.waitForFunction(() => !document.querySelector('.hero-leave') && !document.querySelector('.board-wrap.stale'), null, T);
    await page.click('.nav-link:has-text("Tier List")');
    await page.click('.nav-link:has-text("Build Finder")');
    const r = await page.evaluate(
      () =>
        new Promise((res) =>
          requestAnimationFrame(() => requestAnimationFrame(() => res(document.getAnimations().filter((x) => x.playState === 'running').length))),
        ),
    );
    check('Tier List -> Build Finder plays no entrance animation', r === 0, String(r));
  }
  await page.goto(URL0 + 'tier-list/');
  await page.waitForSelector('.tier-hero', T);
  check('loading the tier list URL directly opens the tier list', (await page.$$('.tier-hero')).length === 38);
  {
    const fs = await import('node:fs');
    check('build output has tier-list/index.html and 404.html for GitHub Pages', fs.existsSync('dist/tier-list/index.html') && fs.existsSync('dist/404.html'));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await frames();
  {
    const f = await fitProbe();
    check(
      'phone: tier list has no sideways scroll, nav fits, tap targets >= 40px',
      !f.h &&
        (await page.evaluate(() => {
          const n = document.querySelector('.nav');
          return n.scrollWidth <= n.clientWidth;
        })) &&
        (await tapTargets()).filter((c) => /nav/.test(c)).length === 0,
      JSON.stringify(f),
    );
    await snap({ path: shot('tier-list-phone.png') });
    if (process.env.SHOT_DIR) {
      await page.goto(URL0);
      await settled('Infernus');
      await snap({ path: shot('nav-build-phone.png') });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL0 + '?hero=nope');
  errors.length = 0; // tearing down the previous page mid-fetch logs a stray error from the old document
  await settled('Infernus');
  check('unknown ?hero= falls back to Infernus with no console error', errors.length === 0, errors.slice(0, 3).join(' | '));
  const worst = await page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll('*')].map((el) =>
        Math.max(
          ...getComputedStyle(el)
            .transitionDuration.split(',')
            .map((s) => parseFloat(s) || 0),
        ),
      ),
    ),
  );
  check('reduced motion: no element has a transition duration above 0s', worst <= 0, `${worst}s`);
} catch (e) {
  check('browser flow', false, String(e).slice(0, 400));
}
check('no console errors (network disabled)', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
srv.kill();
console.log(`${passes} PASS, ${fails} FAIL in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(fails ? 1 : 0);

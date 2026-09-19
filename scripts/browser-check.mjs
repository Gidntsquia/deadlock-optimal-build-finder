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
const shot = (n) => `${SHOT_DIR}/${n}`;
const t0 = Date.now();

const srv = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) {
  if (await fetch(URL0).then((r) => r.ok, () => false)) break;
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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d ? ' — ' + d : ''}`);
};
const T = { timeout: 15000 };
const settled = (name) =>
  page.waitForFunction(
    (h) => document.querySelector('.frame-head h1')?.textContent.startsWith(h) && !document.querySelector('.board-wrap.stale') && document.querySelectorAll('.tiles .tile').length >= 1,
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
const rectOf = async (sel) => {
  let prev = null;
  for (let i = 0; i < 20; i++) {
    const r = await page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
    if (prev && Object.keys(r).every((k) => Math.abs(r[k] - prev[k]) < 0.5)) return r;
    prev = r;
    await page.waitForTimeout(100);
  }
  return prev;
};
const inside = (r, w, h) => r.left >= -0.5 && r.top >= -0.5 && r.right <= w + 0.5 && r.bottom <= h + 0.5 && r.width >= 300;
const BANNED = [/%/, /match/i, /players/i, /win rate/i, /high-rank/i, /Phantom/, /souls by end/i, /Last \d+ days/i, /data from/i, /Validation/i, /measured/i, /README/i];
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
    if (new Set(marks.map((m) => Math.round(m.getBoundingClientRect().left + m.getBoundingClientRect().width / 2))).size !== marks.length) why.push('shared column');
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
      return (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) || (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1);
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
    check('abilities: 4 real Infernus abilities', ['Napalm', 'Flame Dash', 'Afterburn', 'Concussive Combustion'].every((n) => abil.includes(n)) && abil.length === 4, abil.join(', '));
    const g = await gridProbe();
    check('ability grid: rows, columns, point order, 1/2/5 markers', g.length === 0, g.slice(0, 3).join('; '));
  }
  {
    const f = await fitProbe();
    check('fits 1440x900: no scroll, no clipped tiles', !f.v && !f.h && !f.scrollers && !f.clipped, JSON.stringify(f));
    check('no top bar / footer elements', (await page.$$('header, nav, footer, .app-header')).length === 0);
    check('one details control, closed by default', (await page.$$('.details-btn')).length === 1 && (await page.$$('.details')).length === 0);
    let bad = [];
    for (const sel of ['.hero-btn:visible', '.style-switch', '.row.abilities', '.ap-grid', '.share-btn', '.details-btn']) {
      const r = await page.locator(sel).first().boundingBox();
      if (!r || r.x < 0 || r.y < 0 || r.x + r.width > 1440 || r.y + r.height > 900) bad.push(sel);
    }
    check('main controls are inside the viewport', bad.length === 0, bad.join(', '));
    check('main screen has no technical text', !bannedHit(await page.evaluate(() => document.querySelector('main').innerText)));
    check('tap targets >= 40px', (await tapTargets()).length === 0, (await tapTargets()).slice(0, 5).join(', '));
    check('exactly one visible hero control', (await page.$$('.hero-btn:visible')).length === 1);
  }
  await page.screenshot({ path: shot('infernus-build-desktop.png') });

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
      /\d+% match/.test(text) && /[\d,]+ matches/.test(text) && /win rate/i.test(text) && /data from \d{1,2} \w{3} \d{4}/i.test(text) && (await page.$$('.details .panel-table tbody tr')).length >= 1 && badges === tiles,
      text.slice(0, 120),
    );
    await page.screenshot({ path: shot('details-desktop.png') });
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
      !!(await page.$('.sheet-head img')) && chips.some((c) => /^[\d,]+$/.test(c)) && chips.some((c) => /^Tier \d/.test(c)) && chips.some((c) => /Weapon|Vitality|Spirit/.test(c)) && (await page.$$('.sheet .stat-line')).length > 0,
      `${name}: ${chips.join(' | ')}`,
    );
    const r = await rectOf('[role="dialog"]');
    check('item sheet: centred and inside the window', inside(r, 1440, 900) && Math.abs((r.left + r.right) / 2 - 720) <= 2 && Math.abs((r.top + r.bottom) / 2 - 450) <= 2, JSON.stringify(r));
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
    await page.screenshot({ path: shot('item-sheet-desktop.png') });
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
  await page.screenshot({ path: shot('hero-picker-desktop.png') });
  await page.fill('.hero-dialog .hero-filter', 'las');
  const las = await page.$$eval('.hero-dialog .hero-opt', (els) => els.map((e) => e.textContent.trim()));
  check('hero picker: lists every hero; "las" leaves only Lash', allHeroes.length >= 30 && las.length === 1 && las[0].includes('Lash'), `${allHeroes.length} heroes; ${las.join(',')}`);
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
      await page.waitForFunction((b) => document.querySelector('.frame-head h1')?.textContent.split(' - ')[0] !== b && document.querySelector('.board-wrap:not(.stale)'), before, T);
      return [before, await title()];
    };
    const [b1, n1] = await step('Next hero');
    const [, n2] = await step('Previous hero');
    const [, w1] = await step('Previous hero');
    check('arrows: next changes hero, previous returns, previous from first wraps', n1 !== b1 && n2 === b1 && w1 !== b1, `${b1} -> ${n1} -> ${n2} -> ${w1}`);
    await page.locator('button[aria-label="Next hero"]:visible').click();
    await settled(b1);
  }
  await pickHero('Warden');
  {
    const pills = await page.$$('.style-pill');
    if (pills.length >= 2) {
      const before = await page.evaluate(() => document.querySelector('.tiles .tile')?.textContent + document.querySelector('.frame-head h1')?.textContent);
      await pills[1].click();
      await page.waitForFunction((p) => document.querySelector('.tiles .tile')?.textContent + document.querySelector('.frame-head h1')?.textContent !== p, before, T);
      check('Warden: second style tab changes the build and adds style= to the URL', new URL(page.url()).searchParams.has('style'), page.url());
    } else check('Warden: second style tab', false, `${pills.length} style tabs`);
  }

  // ---- fit sample: a few heroes x every style x both desktop sizes (1440 covers the ability grid too) ----
  {
    const bad = [];
    for (const name of ['Infernus', 'Haze', 'Warden', 'Mina']) {
      await gotoHero(name.toLowerCase());
      await settled(name);
      const n = Math.max(1, (await page.$$('.style-pill')).length);
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          await page.locator('.style-pill').nth(i).click();
          await page.waitForFunction((k) => document.querySelectorAll('.style-pill')[k]?.getAttribute('aria-pressed') === 'true' && !document.querySelector('.board-wrap.stale'), i, T);
        }
        await openDetails();
        const want = await page.$$eval('.details .item-table tbody tr', (e) => e.length);
        await closeDetails();
        for (const [w, h] of [[1440, 900], [1920, 1080]]) {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForTimeout(60);
          const f = await fitProbe();
          const g = w === 1440 ? await gridProbe() : [];
          if (f.v || f.h || f.scrollers || f.clipped || f.tiles !== want || !want || g.length) bad.push(`${name}#${i}@${w}: ${JSON.stringify(f)} ${g.slice(0, 2)}`);
        }
        await page.setViewportSize({ width: 1440, height: 900 });
      }
    }
    check('sample heroes x styles fit at 1440x900 and 1920x1080, all items shown, grid correct', bad.length === 0, bad.slice(0, 4).join(' // '));
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
  }

  // ---- error recovery: analytics fetch fails -> Retry, then another hero works ----
  {
    const lines = [];
    const onMsg = (m) => lines.push(m.text());
    page.on('console', onMsg);
    await page.route('**/data/analytics/2.json', (r) => r.abort());
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
    check('analytics failure: Retry shown, hero control still there, analytics_load_failed logged', logged && (await page.$$('.hero-btn:visible, .hero-retry-pick:visible')).length >= 1);
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
  await page.setViewportSize({ width: 390, height: 844 });
  await pickHero('Infernus');
  {
    const f = await fitProbe();
    check('phone: no sideways scroll, whole ability grid visible', !f.h, JSON.stringify(f));
    const grid = await page.evaluate(() => {
      const g = document.querySelector('.ap-grid');
      return g.scrollWidth <= g.clientWidth && [...g.querySelectorAll('.ap-mark')].every((m) => m.getBoundingClientRect().left >= 0 && m.getBoundingClientRect().right <= innerWidth);
    });
    check('phone: ability markers all inside the viewport', grid);
    check('phone: tap targets >= 40px, one hero control, no technical text', (await tapTargets()).length === 0 && (await page.$$('.hero-btn:visible')).length === 1 && !bannedHit(await page.evaluate(() => document.querySelector('main').innerText)));
    await page.screenshot({ path: shot('infernus-build-phone.png'), fullPage: true });
    await openHeroes();
    check('phone: hero sheet fits the screen', inside(await rectOf('.hero-dialog'), 390, 844));
    await page.screenshot({ path: shot('hero-picker-phone.png') });
    await closeHeroes();
    await openDetails();
    check('phone: details sheet fits the screen', inside(await rectOf('.details'), 390, 844));
    await closeDetails();
    await page.click('.tiles .tile');
    await page.waitForSelector('.sheet');
    const r = await rectOf('[role="dialog"]');
    check('phone: item sheet is bottom-anchored, edge to edge, on screen', inside(r, 390, 844) && Math.abs(r.bottom - 844) <= 1 && r.left <= 1 && r.right >= 389, JSON.stringify(r));
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    check('phone: item sheet still on screen after ArrowRight', inside(await rectOf('[role="dialog"]'), 390, 844));
    check('phone: no sideways scroll with the item sheet open', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.screenshot({ path: shot('item-sheet-phone.png') });
    await axe('phone, item sheet open');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await axe('phone, sheet closed');
  }

  // ---- back to desktop: axe, unknown slug, reduced motion ----
  await page.setViewportSize({ width: 1440, height: 900 });
  await axe('desktop');
  await page.goto(URL0 + '?hero=nope');
  errors.length = 0; // tearing down the previous page mid-fetch logs a stray error from the old document
  await settled('Infernus');
  check('unknown ?hero= falls back to Infernus with no console error', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const worst = await page.evaluate(() =>
    Math.max(0, ...[...document.querySelectorAll('*')].map((el) => Math.max(...getComputedStyle(el).transitionDuration.split(',').map((s) => parseFloat(s) || 0)))),
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

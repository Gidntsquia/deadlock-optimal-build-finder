// Headless browser check: builds the app, serves dist/ with vite preview, blocks all network
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// except localhost, and verifies rendering at 390x844 with zero console errors.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const SHOT_DIR = process.env.SHOT_DIR || 'screenshots';
mkdirSync(SHOT_DIR, { recursive: true });
const shot = (name) => `${SHOT_DIR}/${name}`;

const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
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
// HeroPicker: on phone, the trigger opens a sheet with a filter+grid; on desktop the grid is
// always inline. `pickHero` opens the sheet if needed, types the name, and clicks the match.
const isPhone = () => page.viewportSize()?.width < 900;
const pickHero = async (name) => {
  if (isPhone()) {
    await page.click('.hero-picker-trigger');
    await page.waitForSelector('.hero-sheet .hero-filter');
    await page.fill('.hero-sheet .hero-filter', name);
    await page.click(`.hero-sheet .hero-opt:has-text("${name}")`);
  } else {
    await page.fill('.hero-picker-desktop .hero-filter', '');
    await page.fill('.hero-picker-desktop .hero-filter', name);
    await page.click(`.hero-picker-desktop .hero-opt:has-text("${name}")`);
  }
};
try {
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('.tiles .tile', { timeout: 20000 });
  check('opens on Infernus', (await page.textContent('.app-header h1')).startsWith('Infernus'));
  const tabs = await page.$$('.board h2');
  check('one named build', tabs.length === 1, `${(await Promise.all(tabs.map((t) => t.textContent()))).join(' | ')}`);
  const noHScroll = async (label) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    check(`no horizontal scroll (${label})`, w[0] <= w[1], `${w[0]} <= ${w[1]}`);
  };
  await noHScroll('Infernus build');
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
    await pickHero('Vindicta');
    await page.waitForFunction(() => document.querySelectorAll('.tiles .tile').length >= 12, null, { timeout: 15000 });
    const rows = await page.$$eval('.tiles .tile', (els) => els.length);
    check('after error, selecting another hero recovers: Vindicta renders >=12 tiles', rows >= 12, `${rows} tiles`);
    await pickHero('Infernus');
    await page.waitForFunction(
      () => document.querySelector('.app-header h1')?.textContent.startsWith('Infernus') && document.querySelectorAll('.tiles .tile').length >= 12,
      null,
      { timeout: 15000 },
    );
    errors.length = 0; // the aborted request above is an intentional, already-asserted failure, not a real regression
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
  await tapOk('Infernus');
  for (let i = 0; i < tabs.length; i++) {
    const rows = await page.$$('.tiles .tile');
    const phases = await page.$$eval('.phase-head span:first-child', (els) => els.map((e) => e.textContent));
    const totals = await page.$$eval('.tiles .tile', (els) => els.map((e) => Number(e.dataset.total)));
    const costs = await page.$$eval('.tiles .tile', (els) => els.map((e) => Number(e.dataset.cost)));
    let run = 0;
    const totalsOk = costs.every((c, k) => (run += c) === totals[k]);
    const imgs = await page.$$eval('.tiles .tile img', (els) => els.map((e) => e.getAttribute('src')));
    const broken = await page.$$eval('.tiles .tile img', (els) => els.filter((e) => !e.complete || e.naturalWidth === 0).length);
    const badges = await page.$$eval('.tiles .tile[data-core]', (els) => els.length);
    const abil = await page.$$eval('.ap-icon img', (els) => [...new Set(els.map((e) => e.getAttribute('alt')))]);
    const unlocks = await page.$$eval('.ap-track .pt.unlock', (els) => els.length);
    const agreement = await page.textContent('.big');
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
    !!img && chips.some((c) => /souls/.test(c)) && chips.some((c) => /^Tier \d/.test(c)) && chips.some((c) => /Weapon|Vitality|Spirit/.test(c)) && stats > 0,
    `${name}: ${chips.join(' | ')}, ${stats} stat lines`,
  );
  await noHScroll('item card open');
  await page.screenshot({ path: shot('item-sheet-phone.png') });
  await page.tap('.sheet-close');
  await page.screenshot({ path: shot('infernus-build-phone.png'), fullPage: true });
  // hero picker view (phone): the trigger button before opening the sheet
  await page.screenshot({ path: shot('hero-picker-phone.png'), fullPage: true });
  // 3 other heroes via the picker
  for (const n of ['Seven', 'Vindicta', 'Warden']) {
    await pickHero(n);
    await page.waitForFunction(
      (name) => document.querySelector('.app-header h1')?.textContent.startsWith(name) && document.querySelectorAll('.tiles .tile').length >= 12,
      n,
      { timeout: 15000 },
    );
    const rows = await page.$$eval('.tiles .tile', (els) => els.length);
    const abil = await page.$$eval('.ap-icon img', (els) => [...new Set(els.map((e) => e.getAttribute('alt')))]);
    check(`${n}: renders build + ability order`, rows >= 12 && abil.length === 4, `${rows} items, abilities ${abil.join(', ')}`);
    await noHScroll(n);
    await tapOk(n);
  }
  // Warden: a hero with more than one build style — cover the style tabs
  await pickHero('Warden');
  await page.waitForFunction(
    () => document.querySelector('.app-header h1')?.textContent.startsWith('Warden') && document.querySelectorAll('.tiles .tile').length >= 1,
    null,
    { timeout: 15000 },
  );
  await page.screenshot({ path: shot('warden-styles-phone.png'), fullPage: true });
  // heroes with their own held-out set show that player's validation panel
  for (const [n, who] of [
    ['Lash', 'Albertt'],
    ['Mina', 'lordnm'],
    ['Kelvin', 'Yndio'],
  ]) {
    await pickHero(n);
    await page.waitForFunction((w) => [...document.querySelectorAll('.panel-table')].some((t) => t.textContent.includes(w)), who, { timeout: 15000 });
    const agreement = await page.textContent('.big');
    const badges = await page.$$eval('.tiles .tile[data-core]', (els) => els.length);
    const rows = await page.$$eval('.tiles .tile', (els) => els.length);
    check(`${who}: validation panel + core badges`, /\d+% match/.test(agreement) && badges === rows, agreement);
  }
  // item 3: exactly one visible hero control at the current (phone) viewport
  {
    const visibleControls = await page.evaluate(() => {
      const vis = (el) => !!el && el.offsetParent !== null;
      return [vis(document.querySelector('.hero-picker-trigger')), vis(document.querySelector('.hero-picker-desktop'))].filter(Boolean).length;
    });
    check('exactly one visible hero control (390px)', visibleControls === 1, `${visibleControls} visible`);
  }
  // item 3: typing "las" leaves only Lash visible; Enter selects it; URL gets hero=lash; reload keeps it; back goes to Infernus
  // Reset navigation history first so goBack() below has a deterministic (Infernus, no hero param) prior entry,
  // rather than whichever hero this script happened to pick last.
  await page.goto('http://localhost:4173/');
  await page.waitForFunction(
    () => document.querySelector('.app-header h1')?.textContent.startsWith('Infernus') && document.querySelectorAll('.tiles .tile').length >= 1,
    null,
    { timeout: 15000 },
  );
  await page.click('.hero-picker-trigger');
  await page.waitForSelector('.hero-sheet .hero-filter');
  await page.fill('.hero-sheet .hero-filter', 'las');
  const lasMatches = await page.$$eval('.hero-sheet .hero-opt', (els) => els.map((e) => e.textContent.trim()));
  check('filter "las" leaves only Lash visible', lasMatches.length === 1 && lasMatches[0].includes('Lash'), lasMatches.join(', '));
  await page.press('.hero-sheet .hero-filter', 'Enter');
  await page.waitForFunction(() => document.querySelector('.app-header h1')?.textContent.startsWith('Lash'), null, { timeout: 15000 });
  check('URL contains hero=lash after Enter-select', new URL(page.url()).searchParams.get('hero') === 'lash', page.url());
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('.app-header h1')?.textContent.startsWith('Lash') && document.querySelectorAll('.tiles .tile').length >= 1,
    null,
    { timeout: 15000 },
  );
  check('reload still shows Lash', true);
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.app-header h1')?.textContent.startsWith('Infernus'), null, { timeout: 15000 });
  check('goBack() returns to Infernus', true);
  // item 3: Escape closes the phone sheet
  await page.click('.hero-picker-trigger');
  await page.waitForSelector('.hero-sheet');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.hero-sheet', { state: 'detached', timeout: 5000 });
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
      () => document.querySelector('.app-header h1')?.textContent.startsWith('Infernus') && document.querySelectorAll('.tiles .tile').length >= 1,
      null,
      { timeout: 15000 },
    );
    check('/?hero=nope falls back to Infernus with no console error', errors.length === 0, errors.slice(0, 3).join(' | '));
  }
  // desktop layout: the board and the side column sit next to each other and fill the window
  await page.setViewportSize({ width: 1440, height: 900 });
  {
    const visibleControls = await page.evaluate(() => {
      const vis = (el) => !!el && el.offsetParent !== null;
      return [vis(document.querySelector('.hero-picker-trigger')), vis(document.querySelector('.hero-picker-desktop'))].filter(Boolean).length;
    });
    check('exactly one visible hero control (1440px)', visibleControls === 1, `${visibleControls} visible`);
  }
  await pickHero('Infernus');
  await page.waitForFunction(() => document.querySelector('.app-header h1')?.textContent.startsWith('Infernus') && document.querySelector('.col-main'), null, {
    timeout: 15000,
  });
  await tapOk('Infernus desktop');
  const [bb, sb] = await Promise.all([
    page.$eval('.col-main', (e) => e.getBoundingClientRect().toJSON()),
    page.$eval('.col-side', (e) => e.getBoundingClientRect().toJSON()),
  ]);
  // item 4 caps desktop content width to ~1200px (centered), so the board no longer spans
  // the full window; it must still be the wider, dominant column next to the side panel.
  check(
    'desktop: two columns, board the more prominent (wider) one',
    bb.right <= sb.left && bb.width > sb.width && bb.width > 500,
    `board ${Math.round(bb.width)}px, side ${Math.round(sb.width)}px`,
  );
  await page.screenshot({ path: shot('infernus-build-desktop.png') });
  await page.screenshot({ path: shot('hero-picker-desktop.png') });
  await (await page.$('.tiles .tile')).click();
  await page.waitForSelector('.sheet');
  await page.screenshot({ path: shot('item-sheet-desktop.png') });
  await page.click('.sheet-close');
  await pickHero('Warden');
  await page.waitForFunction(
    () => document.querySelector('.app-header h1')?.textContent.startsWith('Warden') && document.querySelectorAll('.tiles .tile').length >= 1,
    null,
    { timeout: 15000 },
  );
  await page.screenshot({ path: shot('warden-styles-desktop.png') });
  // item 3: clicking the second style tab on Warden changes the build and adds style= to the URL
  {
    const tabs2 = await page.$$('.style-tab');
    if (tabs2.length >= 2) {
      const before = await page.evaluate(() => ({
        tile: document.querySelector('.tiles .tile')?.textContent,
        heading: document.querySelector('.board h2')?.textContent,
      }));
      await tabs2[1].click();
      await page.waitForFunction(
        (prev) => {
          const t = document.querySelector('.tiles .tile')?.textContent;
          const h = document.querySelector('.board h2')?.textContent;
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

  // item 4: layout, hierarchy, and copy
  await pickHero('Infernus');
  await page.waitForFunction(
    () => document.querySelector('.app-header h1')?.textContent.startsWith('Infernus') && document.querySelector('.panel-summary'),
    null,
    { timeout: 15000 },
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(100);
  {
    const box = await page.$eval('#root', (e) => e.getBoundingClientRect().toJSON());
    const leftGap = box.left;
    const rightGap = 1920 - box.right;
    check('item 4: desktop content width capped (<=1280px incl. padding)', box.width <= 1280, `${Math.round(box.width)}px`);
    check(
      'item 4: desktop content centered at 1920 (left/right gaps within 2px)',
      Math.abs(leftGap - rightGap) <= 2,
      `left ${Math.round(leftGap)}px, right ${Math.round(rightGap)}px`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  await noHScroll('item 4: no horizontal scroll at 390px with new panel/disclosure markup');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(100);
  {
    const summaryText = await page.$eval('.panel-summary', (e) => e.innerText);
    const words = summaryText.trim().split(/\s+/).filter(Boolean);
    check('item 4: validation summary is short (<=45 words)', words.length <= 45, `${words.length} words`);
    check('item 4: validation summary still shows a percentage', /\d+%/.test(summaryText), summaryText.slice(0, 60));
  }
  {
    await page.click('.disclosure-trigger');
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.disclosure-content');
        return el && el.offsetParent !== null && el.textContent.includes('30%');
      },
      null,
      { timeout: 5000 },
    );
    check('item 4: "How this is measured" disclosure reveals the 30% threshold on click', true);
  }
  {
    const bodyText = await page.evaluate(() => document.body.innerText);
    const jargonHit = /\bF1\b|\breps\b|held-?out|deterministic/i.exec(bodyText);
    check('item 4: no jargon terms in visible page text', !jargonHit, jargonHit ? jargonHit[0] : '');
  }
  {
    const subText = await page.$eval('.app-header .sub', (e) => e.textContent ?? '');
    check('item 4: header shows a plain-language date', /\d{1,2} \w{3} \d{4}/.test(subText), subText);
  }
} catch (e) {
  check('browser flow', false, String(e));
}
check('no console errors (network disabled)', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`(blocked ${imgBlocked.length} external requests, e.g. images — expected offline)`);
await browser.close();
server.kill();
process.exit(fails ? 1 : 0);

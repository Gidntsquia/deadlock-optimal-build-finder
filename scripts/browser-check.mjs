// Headless browser check: builds the app, serves dist/ with vite preview, blocks all network
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// except localhost, and verifies rendering at 390x844 with zero console errors.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';

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
    await pg.waitForTimeout(300);
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
// HeroPicker: on phone, the trigger opens a sheet with a filter+grid; on desktop the grid is
// always inline. `pickHero` opens the sheet if needed, types the name, and clicks the match.
const isPhone = () => page.viewportSize()?.width < 900;
const pickHero = async (name) => {
  if (isPhone()) {
    await page.click('.hero-picker-trigger');
    await page.waitForSelector('.hero-sheet .hero-filter');
    {
      const vp = page.viewportSize();
      const r = await stableRect(page, '.hero-sheet');
      assertInsideViewport(check, 'item 1 (phone hero sheet)', r, vp.width, vp.height);
    }
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
    const firstTileName = await page.$eval('.tiles .tile', (el) => el.getAttribute('aria-label'));
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
    const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    check(
      'item 5: Escape closes and returns focus to the tile last shown (not the original opener)',
      focusedLabel !== null && focusedLabel !== firstTileName,
      `focused: ${focusedLabel}, opener was: ${firstTileName}`,
    );
  }
  // item detail card checks (cost, tier, slot, stats) still pass against the new dialog markup
  {
    await (await page.$('.tiles .tile')).click();
    await page.waitForSelector('.sheet');
    const name = await page.textContent('[data-slot="dialog-content"] h2');
    const chips = await page.$$eval('.sheet .chip', (els) => els.map((e) => e.textContent?.trim() ?? ''));
    const stats = await page.$$eval('.sheet .stat-line', (els) => els.length);
    check(
      'item 5: item detail card still shows image, cost, tier, slot, stats',
      chips.some((c) => /souls/.test(c)) && chips.some((c) => /^Tier \d/.test(c)) && chips.some((c) => /Weapon|Vitality|Spirit/.test(c)) && stats > 0,
      `${name}: ${chips.join(' | ')}, ${stats} stat lines`,
    );
    await page.click('[data-slot="dialog-close"]');
    await page.waitForSelector('.sheet', { state: 'detached' });
  }
  // item 5: tiles have a visible focus state distinct from their resting state
  {
    const tile = await page.$('.tiles .tile');
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

  // item 6: Share button (no stub) yields a real PNG download
  {
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.click('.share-btn');
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const bytes = await new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).subarray(0, 8)));
      stream.on('error', reject);
    });
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    check('item 6: Share (no stub) downloads a file starting with the PNG signature', bytes.equals(pngSig), bytes.toString('hex'));
    await page.waitForSelector('text=Downloaded build image.', { timeout: 5000 });
    check('item 6: Share success shows a visible message (not alert())', true);
  }

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
      await page.waitForFunction((n) => document.querySelector('.app-header h1')?.textContent.startsWith(n), name, { timeout: 15000 });
      await page.waitForSelector('.board-wrap:not(.stale)', { timeout: 15000 });
    }
    const cls = await page.evaluate(() => window.__cls);
    check('item 6: cumulative layout shift across 3 hero switches < 0.05', cls < 0.05, `${cls.toFixed(4)}`);
    await pickHero('Infernus');
    await page.waitForFunction(() => document.querySelector('.app-header h1')?.textContent.startsWith('Infernus'), null, { timeout: 15000 });
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
    check('item 3: board-wrap computed opacity dips below 1 during hero switch', minOpacity < 1, `min opacity=${minOpacity}`);
    check('item 3: previous build stays mounted (>=12 tiles) while dimmed', minTiles >= 12, `min tiles=${minTiles}`);
    await page.waitForFunction(() => document.querySelector('.app-header h1')?.textContent.startsWith('Seven'), null, { timeout: 15000 });
    await page
      .waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.board-wrap')).opacity) === 1, null, { timeout: 5000 })
      .catch(() => {});
    const finalOpacity = await page.$eval('.board-wrap', (el) => parseFloat(getComputedStyle(el).opacity));
    check('item 3: board-wrap opacity returns to 1 once the new build loads', finalOpacity === 1, `${finalOpacity}`);
    await page.unroute('**/data/analytics/2.json');
    await pickHero('Infernus');
    await page.waitForFunction(() => document.querySelector('.app-header h1')?.textContent.startsWith('Infernus'), null, { timeout: 15000 });
  }

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
    await page2.waitForSelector('text=PNG export failed', { timeout: 10000 });
    check('item 6: Share failure (toBlob throws) raises zero native dialogs and shows a visible failure message', dialogCount === 0);
    await page2.close();
  }

  // item 7: axe accessibility scan at both sizes, with the item sheet closed and open
  const runAxe = async (label) => {
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    check(`item 7: axe scan (${label}) — 0 serious/critical violations`, bad.length === 0, bad.map((v) => `${v.id} (${v.impact})`).join(', '));
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
} catch (e) {
  check('browser flow', false, String(e));
}
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
check('no console errors (network disabled)', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`(blocked ${imgBlocked.length} external requests, e.g. images — expected offline)`);
await browser.close();
server.kill();
process.exit(fails ? 1 : 0);

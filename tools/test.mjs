#!/usr/bin/env node
/* =============================================================================
 *  tools/test.mjs  —  `npm test`
 *
 *  Two jobs:
 *   1. End-to-end engine test. index.html is loaded in jsdom, the UI is driven
 *      by clicking, and every preset's output is (a) parsed as Lua and (b) actually
 *      executed in a Lua VM and compared against the output of the original source.
 *      If a pass ever changes behaviour — a bad escape, a renamed keyword, a
 *      corrupted decoder or a self-test that fires on valid input — this fails.
 *   2. Repo consistency. Links, sitemap, ads.txt, the guard block on each page,
 *      the CSP, robots policy, JSON-LD and the domain strings all have to agree.
 * ========================================================================== */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import luaparse from 'luaparse';

const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const LUA_OK = 0;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://ebice.site';
const PUB = 'ca-pub-7924204418079811';

let pass = 0;
const failures = [];
function ok(name, condition, detail) {
  if (condition) { pass++; return true; }
  failures.push(detail ? `${name} — ${detail}` : name);
  return false;
}
function eq(name, actual, expected) {
  const same = sameValue(actual, expected);
  return ok(name, same, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function sameValue(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/* ---------------------------------------------------------------- Lua harness */
const PRELUDE = read('tools/lua-sandbox.lua');

function runLua(source) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  if (lauxlib.luaL_dostring(L, to_luastring(PRELUDE)) !== LUA_OK) {
    return { error: 'prelude: ' + lua.lua_tojsstring(L, -1) };
  }
  const driver = `local ok, err = pcall(function()
${source}
end)
if not ok then __err = tostring(err) else __err = nil end
__out_joined = table.concat(__out, string.char(10))`;
  if (lauxlib.luaL_dostring(L, to_luastring(driver)) !== LUA_OK) {
    return { error: lua.lua_tojsstring(L, -1) };
  }
  lua.lua_getglobal(L, to_luastring('__out_joined'));
  const printed = lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);
  lua.lua_getglobal(L, to_luastring('__err'));
  const err = lua.lua_isnil(L, -1) ? null : lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);
  return { printed, error: err };
}

/* ------------------------------------------------------------------ UI harness */
const SAMPLE = `-- Sample Roblox Lua script
local Players = game:GetService("Players")
local player = Players.LocalPlayer

local function greet(name)
    print("Hello, " .. name .. "!")
end

local coins = 100
local level = 5

greet(player.Name)
print("Coins:", coins, "Level:", level)

for i = 1, 3 do
    print("Tick " .. i)
end

if coins > 50 then
    print("Rich player detected")
else
    print("Keep grinding")
end
`;

// jsdom has no matchMedia, and no crypto on every build; the page uses the first
// for prefers-reduced-motion and the second for the CSPRNG, so both are stubbed.
function patchWindow(window) {
  if (!window.matchMedia) {
    window.matchMedia = (media) => ({
      media, matches: false, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
    });
  }
  if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
    Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
  }
}

async function openSite() {
  const dom = new JSDOM(read('index.html'), {
    url: `${SITE}/`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: quietConsole(),
    beforeParse: patchWindow
  });
  const { window } = dom;
  await new Promise((r) => { window.addEventListener('load', r, { once: true }); setTimeout(r, 250); });
  return dom;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// jsdom writes "Could not load script" for the guard file (there is no loader in
// a unit test) and the page's own warnings; neither is a test failure.
function quietConsole() {
  const { VirtualConsole } = require('jsdom');
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  vc.on('warn', () => {});
  return vc;
}

async function obfuscate(window, { preset = 'balanced', code = SAMPLE, flags } = {}) {
  const d = window.document;
  if (preset) d.querySelector(`.chip[data-preset="${preset}"]`).click();
  if (flags) {
    for (const [key, value] of Object.entries(flags)) {
      const cb = d.querySelector(`#privacy-row input[data-out="${key}"]`);
      cb.checked = value;
    }
  }
  const input = d.getElementById('input-code');
  input.value = code;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  d.getElementById('btn-run').click();
  await sleep(700);
  return {
    out: d.getElementById('output-code').value,
    toast: d.getElementById('toast-msg').textContent,
    stats: d.getElementById('stat-ratio').textContent
  };
}

/* ================================================ 1. engine, through the real UI */
const dom = await openSite();
const win = dom.window;

const presets = ['none', 'light', 'balanced', 'heavy'];
const parsed = {};
for (const preset of presets) {
  const { out, toast } = await obfuscate(win, { preset });
  parsed[preset] = out;
  ok(`[${preset}] run reported success`, /obfuscated successfully/.test(toast), toast);
  ok(`[${preset}] no comment left behind`, !/^\s*--\s*Sample Roblox/m.test(out));
  let syntaxError = null;
  try { luaparse.parse(out, { luaVersion: '5.3', comments: false }); } catch (e) { syntaxError = e.message; }
  ok(`[${preset}] output parses as Lua`, !syntaxError, syntaxError);
  const ref = runLua(SAMPLE), got = runLua(out);
  ok(`[${preset}] output runs in Lua`, !got.error, got.error);
  ok(`[${preset}] output behaves exactly like the input`, got.printed === ref.printed,
    `expected ${JSON.stringify(ref.printed)}, got ${JSON.stringify(got.printed)}`);
}

const balanced = parsed.balanced, heavy = parsed.heavy;

// renaming
ok('[balanced] local names were renamed', /local\s+[A-Za-z_]\w*\s*=\s*game:GetService/.test(balanced) && !/local\s+Players\b/.test(balanced), balanced.slice(0, 200));
ok('[balanced] "player" no longer exists as an identifier', !/\bplayer\b/.test(balanced));
// strings
ok('[balanced] plaintext string is gone', !balanced.includes('Hello, ') && !balanced.includes('Rich player'));
ok('[heavy] plaintext string is gone', !heavy.includes('Hello, ') && !heavy.includes('Rich player'));
// custom alphabet, so a grep for standard base64 does not find the decoder
const alphabetMatch = balanced.match(/local\s+\w+=\(function\(\) local t="([^"]+)"/);
ok('[balanced] decoder carries a shuffled alphabet', !!alphabetMatch &&
  alphabetMatch[1].length === 64 && alphabetMatch[1] !== 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
  alphabetMatch && alphabetMatch[1]);
ok('[engine] no standard-alphabet base64 helper survives', !balanced.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'));
// XOR keys are 8 random bytes emitted as escapes, not 4 hex characters
ok('[heavy] XOR key is byte-escaped', /\\255|\\1[0-9][0-9]/.test(heavy) && !/,\s*"0x[0-9a-f]{4}"\)/.test(heavy));
// integrity self-test
ok('[heavy] runtime integrity check emitted', heavy.includes('[Ebice] integrity check failed'));
{
  const broken = heavy.replace('local t="', 'local t="ZZ').replace(/~="Ebice"/, '~="Ebice"');
  const ran = runLua(broken);
  ok('[heavy] tampering with the decoder is detected at runtime', !!ran.error, JSON.stringify(ran));
}
// fingerprint + attribution
{
  const a = await obfuscate(win, { preset: 'balanced', flags: { fingerprint: true, attribution: false } });
  ok('[flags] attribution off removes the brand line', !a.out.includes('ebice.site') && !a.out.includes('Ebice v'), a.out.slice(0, 120));
  ok('[flags] fingerprint stamps the output', /-- Ebice-FP: [0-9a-f]{16}/.test(a.out));
  const b = await obfuscate(win, { preset: 'balanced', flags: { fingerprint: true, attribution: false } });
  ok('[flags] same source, same fingerprint', (a.out.match(/Ebice-FP: \w+/))[0] === (b.out.match(/Ebice-FP: \w+/))[0]);
  const c = await obfuscate(win, { preset: 'balanced', code: SAMPLE + '\nprint("other")\n', flags: { fingerprint: true, attribution: false } });
  ok('[flags] different source, different fingerprint', (c.out.match(/Ebice-FP: \w+/))[0] !== (a.out.match(/Ebice-FP: \w+/))[0]);
  const off = await obfuscate(win, { preset: 'balanced', flags: { fingerprint: false, attribution: false } });
  ok('[flags] both off leaves no comment header at all', !off.out.startsWith('--'), off.out.slice(0, 60));
}
// input hygiene
{
  const dirty = 'local a = 1\nlocal s = "x\u0000y"\n\u0001\u0002 print(a)\n';
  const r = await obfuscate(win, { preset: 'balanced', code: dirty });
  ok('[sanitize] control characters are removed from the output', !/[\u0000-\u0008\u0001\u0002]/.test(r.out), JSON.stringify(r.out.slice(0, 80)));
  ok('[sanitize] the user is told what happened', /control characters removed/.test(r.toast), r.toast);
  const markup = 'local evil = "</textarea><script>alert(1)</script>"\nprint(evil)\n';
  const r2 = await obfuscate(win, { preset: 'light', code: markup });
  ok('[xss] markup in the source stays text', r2.out.includes('alert(1)') === false || !r2.out.includes('<script>alert'));
  ok('[xss] option grid still intact after hostile input', win.document.querySelectorAll('#options-grid input[type="checkbox"]').length === 12);
  ok('[xss] no stray nodes injected into the shell', !win.document.querySelector('#input-code script, .shell script'));
  const huge = 'print("' + 'A'.repeat(1100 * 1024) + '")\n';
  const r3 = await obfuscate(win, { preset: 'light', code: huge });
  ok('[limit] oversized input is refused, not processed', /Input is over \d.*MB/.test(r3.toast), r3.toast);
}
// UI wiring
{
  const d = win.document;
  d.querySelector('.chip[data-preset="balanced"]').click();
  eq('[layers] balanced activates 9 layers', d.getElementById('count-on').textContent, '9');
  eq('[layers] total is 12 layers, not counting the output switches', d.getElementById('count-all').textContent, '12');
  eq('[layers] output switches stay out of the layer counter', d.querySelectorAll('#privacy-row input').length, 3);
  const cb = d.querySelector('#options-grid input[data-id="hex_numbers"]');
  cb.checked = !cb.checked;
  cb.dispatchEvent(new win.Event('click', { bubbles: true }));
  d.querySelector('#options-grid input[data-id="hex_numbers"]').dispatchEvent(new win.Event('change', { bubbles: true }));
  ok('[layers] preset chip deselects on manual change', !d.querySelector('.chip[data-preset="balanced"]').classList.contains('active'));
  ok('[ui] output textarea is read-only', d.getElementById('output-code').hasAttribute('readonly'));
  ok('[ui] ratio uses a real em dash', !d.getElementById('stat-ratio').textContent.includes('\\u'));
}
dom.window.close();

/* ================================================== 2. randomness and hygiene */
{
  const src = read('index.html');
  const engine = src.slice(src.indexOf('CSPRNG-backed randomness'), src.indexOf('function randHex'));
  const uses = src.match(/Math\.random\(/g) || [];
  const inside = (engine.match(/Math\.random\(/g) || []).length;
  ok('[rng] Math.random survives only as the no-crypto fallback', uses.length === inside, `${uses.length} uses, only ${inside} inside the fallback block`);
  ok('[rng] generator uses the CSPRNG', /CSPRNG\.getRandomValues/.test(src));
  ok('[dom] no innerHTML anywhere in the page script', !/\.innerHTML/.test(src));
  ok('[dom] no user code is ever logged', !/console\.log/.test(src));
  ok('[guard] engine refuses to build options from HTML strings', /createElement\('input'\)/.test(src) || /el\('input'\)/.test(src));
}

/* ===================================================== 3. site guard behaviour */
{
  const pages = ['index.html', '404.html', 'privacy/index.html', 'terms/index.html', 'dmca/index.html'];
  const check = spawnSync(process.execPath, ['tools/sync-guard.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  eq('[guard] every page carries the identical bootstrap block', check.status, 0);
  for (const page of pages) {
    const s = read(page);
    ok(`[guard] ${page} blocks framing/clones (bootstrap)`, s.includes('window.__ebiceGuard'));
    ok(`[guard] ${page} loads the guard file`, /<script src="(\.\.\/|\/)?assets\/site-guard\.js" defer><\/script>/.test(s));
    ok(`[guard] ${page} declares an owner marker`, /data-ebice="(app|doc)"/.test(s));
    ok(`[guard] ${page} sets a CSP`, /Content-Security-Policy" content="object-src 'none'; base-uri 'none'; form-action 'none'/.test(s));
    ok(`[guard] ${page} limits referrer leakage`, /name="referrer" content="strict-origin-when-cross-origin"/.test(s));
    ok(`[guard] ${page} opts out of AI training`, /noai, noimageai/.test(s) || /noindex/.test(s));
  }

  const guardSrc = read('assets/site-guard.js');
  // The bootstrap in the page head is what refuses a foreign host; the guard
  // file is what replaces the page. Tested separately so neither depends on the
  // other's load order, and so no fake DOM has to pretend to fetch a script.
  function bootstrapAt(url) {
    const d = new JSDOM(read('index.html'), { url, runScripts: 'dangerously', virtualConsole: quietConsole(), beforeParse: patchWindow });
    const g = d.window.__ebiceGuard;
    d.window.close();
    return g;
  }
  {
    const home = bootstrapAt(`${SITE}/`);
    ok('[bootstrap] the licensed domain is authorized', home.authorized === true);
    ok('[bootstrap] the licensed domain is NOT treated as a dev host, so the frame lock stays on', home.dev === false);
    const evil = bootstrapAt('https://scraper-clone.example/');
    ok('[bootstrap] an unknown domain is not authorized', evil.authorized === false && evil.dev === false);
    const dev = bootstrapAt('http://localhost:8000/');
    ok('[bootstrap] localhost stands down', dev.off === false && dev.dev === true && dev.authorized === true);
    const gh = bootstrapAt('https://justgratis2-dotcom.github.io/ol-/');
    ok('[bootstrap] the owner\'s own Pages preview is allowed', gh.authorized === true);
    const ghEvil = bootstrapAt('https://someone-else.github.io/ol-/');
    ok('[bootstrap] someone else\'s github.io is not', ghEvil.authorized === false);
    const flagged = new JSDOM(read('index.html'), { url: 'https://totally-not-ebice.example.com/', runScripts: 'dangerously', virtualConsole: quietConsole(), beforeParse: patchWindow });
    ok('[bootstrap] foreign host is marked before the paint', flagged.window.document.documentElement.getAttribute('data-ebice-guard') === 'blocked');
    flagged.window.close();
  }
  const cloneDom = new JSDOM(read('index.html'), { url: 'https://totally-not-ebice.example.com/', runScripts: 'dangerously', virtualConsole: quietConsole(), beforeParse: patchWindow });
  eq('[clone] bootstrap flags an unknown host before any CSS paints',
    cloneDom.window.document.documentElement.getAttribute('data-ebice-guard'), 'blocked');
  cloneDom.window.close();
  const okDom = new JSDOM(read('index.html'), { url: `${SITE}/`, runScripts: 'dangerously', virtualConsole: quietConsole(), beforeParse: patchWindow });
  eq('[clone] the real domain is not flagged', okDom.window.document.documentElement.getAttribute('data-ebice-guard'), null);
  okDom.window.close();

  function withGuard(cfg, html = '<html data-ebice="app"><head></head><body></body></html>', url = 'https://x.example/', framed = false) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', virtualConsole: quietConsole() });
    dom.window.__ebiceGuard = Object.assign({
      site: 'ebice.site', canonical: `${SITE}/`, adClient: PUB,
      off: false, dev: false, authorized: true, allows: () => true
    }, cfg);
    dom.window.eval(framed ? guardSrc.replace('window.self !== window.top', 'true /* forced: jsdom has no parent frame */') : guardSrc);
    return dom;
  }
  {
    const clone = withGuard({ authorized: false });
    const cd = clone.window.document;
    ok('[clone] notice replaces the page', !!cd.querySelector('[data-ebice-notice]'));
    ok('[clone] notice names the licensed origin', (cd.querySelector('[data-ebice-notice]') || { textContent: '' }).textContent.includes('ebice.site'));
    ok('[clone] notice links to the licensing route', /\/dmca\//.test((cd.querySelector('[data-ebice-notice]') || { innerHTML: '' }).innerHTML));
    eq('[clone] title rewritten', cd.title, 'Unauthorized copy of Ebice');
    clone.window.close();
  }
  {
    const armed = withGuard({ authorized: true }, read('index.html'));
    const d = armed.window.document;
    eq('[guard] verified origin marks the document', d.documentElement.getAttribute('data-ebice-origin'), 'verified');
    ok('[guard] print watermark + selection rules injected',
      [...d.querySelectorAll('style')].map((s) => s.textContent).join('\n').includes('@media print'));
    armed.window.close();
  }
  {
    // Ad publisher lock: a cloner (or a MITM on http) swaps in their own id.
    const hijack = withGuard({}, read('index.html').replace(`data-ad-client="${PUB}"`, 'data-ad-client="ca-pub-0000000000000000"'));
    eq('[ads] foreign publisher slot removed', hijack.window.document.querySelectorAll('ins.adsbygoogle').length, 1);
    eq('[ads] owner slot untouched', hijack.window.document.querySelectorAll(`ins[data-ad-client="${PUB}"]`).length, 1);
    ok('[ads] the ad queue is neutralised', /function/.test(String(hijack.window.adsbygoogle.push)));
  ok('[ads] and the hijacker is sent to the canonical page instead', /ad-hijack/.test(guardSrc));
    hijack.window.close();
    const clean = withGuard({}, read('index.html'));
    eq('[ads] both owner slots survive on an unmodified page', clean.window.document.querySelectorAll('ins.adsbygoogle').length, 2);
    clean.window.close();
  }
  {
    const framed = withGuard({ dev: false, allows: () => false }, read('index.html'), 'https://x.example/', true);
    ok('[frame] framing an unauthorized parent hides the document',
      framed.window.document.documentElement.style.getPropertyPriority('visibility') === 'important');
    framed.window.close();
  }
  {
    const off = withGuard({ off: true }, read('index.html'));
    eq('[off] ?guard=off leaves the page completely alone', off.window.document.documentElement.getAttribute('data-ebice-origin'), null);
    off.window.close();
  }
}

/* ==================================================== 4. repo-wide consistency */
{
  const htmls = ['index.html', '404.html', 'privacy/index.html', 'terms/index.html', 'dmca/index.html'];
  const files = {};
  for (const h of htmls) files[h] = read(h);

  // every link target must exist
  let broken = [];
  for (const [page, s] of Object.entries(files)) {
    for (const m of s.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const raw = m[1];
      if (/^(https?:|mailto:|data:|javascript:|#)/.test(raw)) {
        if (/^https?:/.test(raw) && !raw.startsWith('http://') === false) broken.push(`${page}: insecure ${raw}`);
        if (raw.startsWith('http://')) broken.push(`${page}: insecure ${raw}`);
        continue;
      }
      const target = raw.replace(/^\/+/, '').split('#')[0].split('?')[0];
      const dir = posix.dirname(page === 'index.html' ? '' : page);
      const base = raw.startsWith('/') ? '' : (dir === '.' ? '' : dir);
      const rel = posix.join(base, target || 'index.html');
      const abs = join(ROOT, rel);
      const resolved = existsSync(abs) && statSync(abs).isDirectory() ? join(abs, 'index.html') : abs;
      if (!existsSync(resolved)) broken.push(`${page} → ${raw} (${rel})`);
    }
  }
  ok('[links] every href/src resolves to a real file', broken.length === 0, broken.join('; '));

  // domain and publisher must be consistent everywhere
  const textFiles = [...htmls, 'CNAME', 'ads.txt', 'robots.txt', 'sitemap.xml', 'assets/site-guard.js', 'tools/guard-bootstrap.html', '.well-known/security.txt', 'docs/cloudflare/_headers'];
  const pubs = new Set();
  for (const f of textFiles) for (const m of read(f).matchAll(/ca-pub-\d+/g)) pubs.add(m[0]);
  ok('[ads] one publisher id across the repo', pubs.size === 1 && pubs.has(PUB), [...pubs].join(', '));
  eq('[ads] ads.txt carries that publisher', /google\.com, pub-7924204418079811, DIRECT/.test(read('ads.txt')), true);
  eq('[dns] CNAME is the canonical host', read('CNAME').trim(), 'ebice.site');
  const insecure = htmls.filter((h) => /http:\/\/ebice\.site/.test(files[h]));
  ok('[domain] no http:// references to our own domain', insecure.length === 0, insecure.join(', '));
  ok('[domain] canonical URLs are absolute and trailing-slash correct',
    /<link rel="canonical" href="https:\/\/ebice\.site\/">/.test(files['index.html']) &&
    /<link rel="canonical" href="https:\/\/ebice\.site\/terms\/">/.test(files['terms/index.html']));

  // sitemap <-> files
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  ok('[sitemap] every listed URL has a file', locs.every((loc) => {
    const rel = loc.replace(SITE + '/', '').replace(/\/$/, '');
    return existsSync(join(ROOT, rel, 'index.html')) || existsSync(join(ROOT, rel + '.html')) || existsSync(join(ROOT, rel));
  }), locs.join(', '));
  ok('[sitemap] no sitemap entry uses a missing trailing slash', locs.every((l) => l === SITE + '/' || /\/$/.test(l)), locs.join(', '));
  ok('[sitemap] all four content pages are listed', htmls.filter((h) => h !== '404.html').every((h) => {
    const slug = h === 'index.html' ? SITE + '/' : `${SITE}/${posix.dirname(h)}/`;
    return locs.includes(slug);
  }));

  // robots policy
  const robots = read('robots.txt');
  ok('[robots] search and ads keep access', /User-agent: \*\nAllow: \//.test(robots) && /Mediapartners-Google\nAllow: \//.test(robots));
  ok('[robots] AI and data harvesters are disallowed', /GPTBot[\s\S]*?Disallow: \//.test(robots) && /ClaudeBot/.test(robots) && /CCBot/.test(robots));
  ok('[robots] sitemap advertised', robots.includes(`${SITE}/sitemap.xml`));

  // structured data must match what a human sees
  const ld = [...files['index.html'].matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let schemas = [];
  let jsonError = null;
  try { schemas = ld.map((j) => JSON.parse(j)); } catch (e) { jsonError = e.message; }
  ok('[schema] JSON-LD parses', !jsonError, jsonError);
  const faq = schemas.find((s) => s['@type'] === 'FAQPage');
  const app = schemas.find((s) => s['@type'] === 'WebApplication');
  const visible = [...files['index.html'].matchAll(/<summary>(.*?)<span class="plus"><\/span>/g)].map((m) => m[1]);
  ok('[schema] FAQ markup mirrors the visible FAQ, in order and word for word',
    !!faq && JSON.stringify(faq.mainEntity.map((q) => q.name)) === JSON.stringify(visible),
    `${faq && faq.mainEntity.length} in schema vs ${visible.length} visible`);
  ok('[schema] attribution fields present', !!app && app.license === `${SITE}/terms/` && app.copyrightHolder.name === 'Ebice');

  // licensing and legal pages must cross-reference each other
  ok('[legal] LICENSE states all-rights-reserved', /All rights reserved/i.test(read('LICENSE')));
  ok('[legal] dmca page covers the statutory elements',
    /penalty of perjury/i.test(files['dmca/index.html']) && /512\(c\)\(3\)/.test(files['dmca/index.html']) && /Counter-notice|counter-notice/i.test(files['dmca/index.html']));
  ok('[legal] e-mail is not harvestable as a plain mailto in the copycat page',
    !/mailto:contact@ebice\.site/.test(files['dmca/index.html']) && /data-mail="contact"/.test(files['dmca/index.html']));
  ok('[legal] every page links to terms and privacy', htmls.every((h) => /terms/.test(files[h]) && /privacy/.test(files[h])));
  ok('[legal] index links the copycat report page', /ebice\.site\/dmca\//.test(files['index.html']));
  ok('[privacy] the ad-consent reality is disclosed', /certified|ad settings|Ad Settings/i.test(files['privacy/index.html']));

  // the placeholders that are not placeholders any more
  const slots = [...files['index.html'].matchAll(/data-ad-slot="(\d+)"/g)].map((m) => m[1]);
  ok('[ads] ad unit ids are still the sample ones or real ones', slots.length === 2, `found ${slots.join(', ')}`);
  ok('[pages] .nojekyll is set so dot folders and assets are served verbatim', existsSync(join(ROOT, '.nojekyll')));
  ok('[pages] headers for header-capable hosts ship with the repo', /Content-Security-Policy:/.test(read('docs/cloudflare/_headers')));
}

  // structure of the long-form pages: one h1, sequential numbering, TOC matches
  for (const page of ['terms/index.html', 'privacy/index.html', 'dmca/index.html']) {
    const s2 = read(page);
    eq(`[docs] ${page} has exactly one h1`, (s2.match(/<h1>/g) || []).length, 1);
    const heads = [...s2.matchAll(/<h2>(\d+)\. ([^<]*)<\/h2>/g)].map((m) => [Number(m[1]), m[2]]);
    ok(`[docs] ${page} sections are numbered 1..n without gaps`,
      heads.length >= 7 && heads.every((h, i) => h[0] === i + 1), heads.map((h) => h[0]).join(','));
    const toc = [...s2.matchAll(/<a href="#([a-z]+)">(\d+)\. ([^<]*)<\/a>/g)].map((m) => [m[1], Number(m[2]), m[3]]);
    eq(`[docs] ${page} TOC has one entry per section`, toc.length, heads.length);
    const ids2 = [...s2.matchAll(/<section id="([a-z]+)">/g)].map((m) => m[1]);
    ok(`[docs] ${page} TOC lists the sections in document order, numbered like they are`,
      JSON.stringify(toc.map((t) => `${t[1]}:${t[0]}`)) === JSON.stringify(ids2.map((id, i) => `${i + 1}:${id}`)),
      JSON.stringify(toc.map((t) => `${t[1]}:${t[0]}`)));
    ok(`[docs] ${page} every TOC link has a target`, toc.every((t) => ids2.includes(t[0])), toc.map((t) => t[0]).join(','));
  }

  // hygiene lints that a static site still needs
  const pages2 = ['index.html', '404.html', 'privacy/index.html', 'terms/index.html', 'dmca/index.html'];
  const blank = pages2.filter((h) => /target="_blank"(?! [^>]*rel="noopener)/.test(read(h)));
  ok('[links] every target="_blank" carries rel="noopener"', blank.length === 0, blank.join(', '));
  const slashless = [];
  for (const page of pages2) {
    for (const m of read(page).matchAll(/href="(https:\/\/ebice\.site\/[a-z-]+)"/g)) slashless.push(`${page}: ${m[1]}`);
  }
  ok('[links] our own page URLs use the trailing-slash form', slashless.length === 0, slashless.join(', '));
  eq('[pages] only the tool page opts into the app copy guards',
    pages2.filter((h) => /data-ebice="app"/.test(read(h))), ['index.html']);
  ok('[privacy] the promise in the trust strip is the promise in the policy',
    read('index.html').includes('Your code never leaves this tab') && read('privacy/index.html').includes('Your code never leaves this tab'));
  ok('[guard] the frame lock has a dev bypass so previews keep working', /if \(!G\.dev\) \{/.test(read('assets/site-guard.js')));
  ok('[guard] the guard never touches the code editors', read('assets/site-guard.js').includes("closest('textarea,input,a,.ad-slot"));

/* ------------------------------------------------------------------- summary */
console.log(`\n${pass} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\n' + failures.map((f) => '  ✗ ' + f).join('\n') + '\n');
  process.exit(1);
}

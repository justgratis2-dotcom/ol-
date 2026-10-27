#!/usr/bin/env node
/* =============================================================================
 *  tools/sync-guard.mjs
 *  Keeps the integrity bootstrap in tools/guard-bootstrap.html byte-identical
 *  across every page of the site, with the right relative path to
 *  assets/site-guard.js for each page's depth.
 *
 *    node tools/sync-guard.mjs           # write the block into every page
 *    node tools/sync-guard.mjs --check   # exit 1 if any page drifted (npm test)
 * ========================================================================== */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLOCK_FILE = join(ROOT, 'tools/guard-bootstrap.html');
const BEGIN = '<!-- ebice:guard:begin';
const END = '<!-- ebice:guard:end -->';

// page -> path from that page back to the repo root (where /assets lives)
const PAGES = {
  'index.html': '',
  '404.html': '/',            // 404 is served for arbitrary depths, so pin it to the root
  'privacy/index.html': '../',
  'terms/index.html': '../',
  'dmca/index.html': '../'
};

const block = (await readFile(BLOCK_FILE, 'utf8')).trim();

let failed = false;
for (const [rel, prefix] of Object.entries(PAGES)) {
  const path = join(ROOT, rel);
  const wanted = block.replace('src="assets/site-guard.js"', `src="${prefix}assets/site-guard.js"`);
  const html = await readFile(path, 'utf8');
  const start = html.indexOf(BEGIN);
  const current = start === -1 ? null : html.slice(start, html.indexOf(END, start) + END.length);

  if (current === wanted) continue;
  failed = true;
  if (process.argv.includes('--check')) {
    console.error(`${rel}: the guard block is missing or out of sync (run: node tools/sync-guard.mjs)`);
    continue;
  }
  if (current === null) {
    // insert after the canonical link (or the theme-color meta) so the block is early and stable
    const anchor = /<link rel="canonical"[^>]*>\n|<meta name="theme-color"[^>]*>\n/.exec(html);
    if (!anchor) throw new Error(`${rel}: no anchor to insert the guard block after`);
    const at = anchor.index + anchor[0].length;
    await writeFile(path, html.slice(0, at) + wanted + '\n' + html.slice(at));
  } else {
    await writeFile(path, html.slice(0, start) + wanted + html.slice(start + current.length));
  }
  console.log(`updated ${rel}`);
}

if (failed && process.argv.includes('--check')) process.exit(1);

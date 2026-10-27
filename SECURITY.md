# Ebice — security, anti-theft and hosting notes

Everything in this repo that exists to stop people taking what is yours, what each
piece actually buys you, and what the owner still has to do outside the repo.

The site is a **static page with no server**: there is no database, no login, no
upload endpoint and no API key to leak. The realistic threats are therefore
(1) someone cloning the site and keeping the traffic and the ad revenue,
(2) someone taking the users' code, (3) the page being used as a way to run
something hostile in a visitor's browser, (4) the repo itself being abused.

---

## 1. What is in the repo

| Layer | Where | Stops | Bypassed by |
| --- | --- | --- | --- |
| Origin lock — unknown host gets a notice and is bounced to `ebice.site` | inline bootstrap in each page `<head>` + `assets/site-guard.js` | lazy mirrors, `html`-only scrapers, "Ebice 2.0" copies that get traffic | deleting the bootstrap, or proxying your domain |
| Ad publisher lock — any `data-ad-client` / loader `ca-pub-…` that is not the owner's id is removed, and the AdSense queue is neutralised | `assets/site-guard.js` | a cloner swapping in their own publisher id, ad code injected by a MITM on `http://` | editing the copied HTML (then they have no ad code at all) |
| Frame lock — the page refuses to render inside another site | `assets/site-guard.js` | clickjacking/"tool inside a scam page" embedding, framing by an adversary | `frame-ancestors` via header is the strong version (see §3) |
| `<base>` / plugin / form lock — CSP `base-uri 'none'; object-src 'none'; form-action 'none'` | meta CSP, every page | an injected `<base>` rewriting all relative URLs to an attacker host, `<object>` payloads, exfiltration through an injected `<form>` | — (it is a real browser-enforced policy) |
| No inline-script allowlist in the meta CSP | — | — | deliberate: Google's ad code needs `'unsafe-inline'`, and a hash goes stale on every edit |
| Copy/selection/print guards, attribution appended to long selections, print watermark | `assets/site-guard.js` (injected CSS) | casual "select all → paste into my site" and PDF/print theft | view-source, an API fetch, devtools |
| `robots.txt` disallow list for AI/data harvesters + `noai` / `noimageai` meta | `robots.txt`, page heads | compliant crawlers, and it is the documented signal that training/mirroring is not licensed | any crawler that ignores robots.txt (most of them) |
| Canonical URL, `rel="license"`, `og:site_name`, schema.org `WebApplication` with `copyrightHolder` / `license`, `ads.txt` | page heads | content farms ranking above you, unlicensed ad bidding on your name | nothing — this is the "who is the original" record |
| Legal layer: `LICENSE`, Terms §5, `/dmca/` page with notice + counter-notice process | repo + site | the things code cannot stop: mirrors, resellers, abuse claims | nothing; it is the part that has consequences |
| Ownership stamp in the generated Lua (FNV-1a fingerprint of the source, optional) | `index.html` engine | "I wrote that script" arguments about a leaked *output* | re-running the obfuscator with the stamp off |
| CSPRNG (`crypto.getRandomValues`) + per-run Base64 alphabet + 8-byte random XOR keys | `index.html` engine | a cloner's claim that output is trivially reversible; public base64 signature matching; predictable names | nothing here — it is a genuine improvement of the product |
| Runtime integrity self-test (anti-tamper layer emits a known-answer check of the decoders) | engine | silently rewriting/stripping the preamble of an obfuscated script | removing the layer before generating |
| Input hygiene: 1 MB cap on the source, 2 MB on dropped files, binary-file sniff, control chars stripped, DOM-only option building, `textContent` for stats | engine | huge pastes locking the tab, dropped binaries, `</textarea>`-style markup injection into the UI | — |
| `.nojekyll` | repo root | Jekyll processing of `{{`/`{%` in Lua-flavoured text, and dot-folders being dropped (`.well-known` would 404) | — |
| `?guard=off`, `sessionStorage.ebice-guard='off'`, `guard:false` in the bootstrap | — | nothing — these exist so **you** can always debug your own site | — |

## 2. What deliberately is *not* here

* **Devtools blocking, F12/Ctrl+U interception, keyboard hooking.** It does not
  stop anyone (a single `curl` gets the file), it breaks honest users who are
  debugging their own script, and it is the number one reason tool sites get
  distrusted. Not worth your reputation.
* **Encrypting/minifying the shipped JS to hide it.** The repo is public, the
  files are served to the browser, and it would make your own debugging worse.
* **Web Watermarking / canvas fingerprint DRM of images.** No images of value
  here beyond `og-image.png`; §3 covers hotlinking properly.
* **A hand-rolled cookie banner.** Google requires a *certified* CMP for EEA/UK/CH
  traffic (since 16 Jan 2024, Switzerland since 31 Jul 2024, TCF v2.3 mandatory
  since 1 Mar 2026). A DIY banner is not certified and pushes you to limited
  ads — do §3 item 2 instead.

* **Blocking every non-allowlisted host, unconditionally.** The `preview` list in
  the bootstrap (localhost, Vercel/Netlify/Pages previews, sandbox hosts) is there so
  you can always open and debug your own copy. Every entry in it is also a hole a
  copycat can hide in — trim it to the hosts you actually use.

## 3. Owner checklist (outside the repo, biggest wins first)

1. **Enforce HTTPS.** `gh api -X PUT /repos/justgratis2-dotcom/ol-/pages -f https_enforced=true`
   or Settings → Pages → "Enforce HTTPS". Today the Pages API reports
   `https_enforced: false`, so visitors can be served over plain HTTP — that is
   the one setting that lets an on-path attacker inject script into *your* page
   and keep it out of your source. Only turn it on once `https://ebice.site`
   works from a clean profile (and, if you proxy through Cloudflare, set SSL/TLS
   mode to **Full**, not Flexible, or you get a redirect loop).
2. **Consent for ads.** AdSense → *Privacy and messaging* → turn on Google's CMP /
   "Maximize message coverage". Without a certified CMP, EEA/UK users get limited
   ads and you lose the revenue the site exists to earn.
3. **Put Cloudflare (free) in front of the domain.** Then, in order of value:
   * Security → WAF: rate-limit `/*` (e.g. 60 req/min per IP) — this is the only
     thing on the list that actually throttles a scraper;
   * Scraping protection → **Bot Fight Mode** on;
   * Speed → Optimization → **Hotlink protection** for `*.png`, `*.svg`
     (allow `ebice.site`, and add `*.facebook.net`, `*.twitter.com`,
     `t.co`-side crawlers if link previews break);
   * Rules → Modify Response Headers: apply `docs/cloudflare/_headers` values
     (or move the deploy to Cloudflare Pages, which reads that file directly).
4. **Harden the repo.** `has_wiki` is on and adds an editable surface for a
   public site: Settings → uncheck *Wikis*. Then enable *Secret scanning* +
   *Push protection* and *Private vulnerability reporting*
   (`gh api -X PUT /repos/justgratis2-dotcom/ol-/vulnerability-alerts`), and
   protect `main` so nobody can push a poisoned engine into the site you serve.
5. **Decide on the Wayback Machine.** `robots.txt` now disallows `ia_archiver`,
   which prevents *new* snapshots; existing ones have to be removed by request
   (web.archive.org → "Save Page Now" errors → removal request).
6. **Keep `ads.txt` and `CNAME` in sync with the publisher id** — `ca-pub-7924204418079811`
   appears in `ads.txt`, both ad slots, the guard config in every page head, and
   `assets/site-guard.js`. If the id changes, update all five or the ad lock
   starts deleting your own slots.
7. **Replace the placeholder ad slot ids** (`1234567890`, `9876543210`) with real
   AdSense unit ids — until then no ad can ever fill and the lock has nothing to
   compare against in production.

## 4. Moving the site, or adding a domain

1. Edit `allow` (and `allowPath` for a `user.github.io/repo/` preview) in
   `tools/guard-bootstrap.html`.
2. Run `node tools/sync-guard.mjs` — it writes the block into all five pages, and
   `npm test` fails if any page drifts.
3. Then the other places the domain is written: canonical/`og:url` links in each
   page, `.well-known/security.txt`, `robots.txt`, `sitemap.xml`, `CNAME` and
   `ads.txt`. `npm test` checks they all still agree with `ebice.site`, so a
   half-moved site fails the test instead of shipping.

Debug a blocked page with `?guard=off` (also disables the ad lock), or set
`guard: false` in the bootstrap to switch the whole layer off.

## 5. Verifying

```bash
npm install
npm test              # engine round-trips through a Lua parser, per preset
                      # + link/CSP/guard/legal-consistency checks
python3 -m http.server 8080   # or: npm run serve
```

What to look at by hand after a deploy:

* `curl -I https://ebice.site/` — no custom headers until §3.3 is done. That is
  expected; do not trust a scanner grade as proof the repo is configured right.
* The pill in the header shows “· origin verified” only on an allowed host.
* Devtools console on a disallowed host should show the
  `assets/site-guard.js did not load` warning if the copy is incomplete.

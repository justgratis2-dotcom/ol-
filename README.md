# Ebice — ebice.site

A multi-layer Lua obfuscator for Roblox scripts that runs entirely in the
browser, plus the layer that stops other people serving it as their own tool.
Static site: no build step, no framework, no server — GitHub Pages serves the
files in this repo.

    index.html                 the tool: styles, engine and UI in one file
    assets/site-guard.js       origin lock, frame lock, ad-publisher lock, copy guards
    tools/guard-bootstrap.html the guard config (the one place to edit for a new domain)
    tools/sync-guard.mjs       writes that block into every page / verifies they match
    tools/test.mjs             npm test: Lua round-trip tests + repo consistency checks
    tools/lua-sandbox.lua      the fake Roblox globals the tests run scripts against
    docs/cloudflare/_headers   security headers for hosts that can send them (not Pages)
    dmca/index.html            rights, copycats, takedown and counter-notice
    SECURITY.md                what each protection layer buys, its limits, owner checklist

## Run it locally

```bash
python3 -m http.server 8080      # or: npm run serve
npm install && npm test          # engine must still produce valid Lua for every preset
```

## Deploy

Push to `main`. GitHub Pages (legacy Jekyll build, `CNAME` → `ebice.site`) serves
the repo root; `.nojekyll` means files are served byte-for-byte.

## If you came here to copy it

Read [LICENSE](LICENSE) and [/dmca/](https://ebice.site/dmca/) first. Using the
tool is free and needs no permission; your scripts stay yours. Taking the site is
a different thing, and the practical parts of that — traffic and ad revenue — are
already addressed in code.

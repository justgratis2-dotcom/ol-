/* =============================================================================
 *  Ebice — site guard
 *  Anti-clone, anti-frame, ad-publisher lock, copy attribution, print stamp.
 * ==========================================================================
 *  Loaded by every page. The *allowlist* lives in the inline bootstrap in each
 *  page's <head> (window.__ebiceGuard) so there is only one place to edit when
 *  the domain changes. See SECURITY.md for what this can and cannot do.
 *
 *  Layers (weakest first, all client-side and therefore bypassable by anyone
 *  willing to edit the copied files — the durable protections are the legal
 *  notice, the /dmca/ process, the origin canonical and HTTPS):
 *    1. origin lock   — unknown host => blocked notice + bounce to ebice.site
 *    2. frame lock    — refuses to be rendered inside someone else's page
 *    3. ad lock       — kills any AdSense client id that is not the owner's
 *    4. copy lock     — selection/print guards, attribution appended on copy
 *    5. self check    — the bootstrap in the head warns if this file is missing
 * ========================================================================== */
(function () {
  'use strict';

  var G = window.__ebiceGuard;
  if (!G || G.off) return;                       // guard disabled via ?guard=off / config
  window.__ebiceGuardLoaded = true;               // the inline bootstrap checks for this

  var root = document.documentElement;
  var IS_APP = root.getAttribute('data-ebice') === 'app';

  /* --- 1. origin lock ----------------------------------------------------- */
  if (!G.authorized) {
    root.setAttribute('data-ebice-guard', 'blocked');
    document.title = 'Unauthorized copy of Ebice';
    showNotice();
    var redirect = function () {
      var url = G.canonical + '?from=' + encodeURIComponent(location.hostname);
      try { window.top.location.replace(url); }
      catch (e) { try { location.replace(url); } catch (e2) {} }
    };
    // Give the notice a moment so a human sees why they are being moved.
    setTimeout(redirect, G.dev ? 5000 : 1500);
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && !e.target.closest('a')) e.preventDefault();
    }, true);
    return;
  }
  root.setAttribute('data-ebice-origin', 'verified');

  function showNotice() {
    var box = document.createElement('div');
    box.setAttribute('data-ebice-notice', '');          // kept visible by the bootstrap CSS
    box.setAttribute('style', 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:#07080b;' +
      'color:#f2f5fb;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;padding:24px');
    box.innerHTML = '<div style="max-width:520px;text-align:center">' +
      '<div style="width:52px;height:52px;margin:0 auto 18px;border-radius:14px;background:linear-gradient(140deg,#6d5cff,#2b2a66);' +
      'display:grid;place-items:center;font-weight:700;font-size:24px;color:#fff">E</div>' +
      '<h1 style="font-size:21px;margin:0 0 10px">This is not the real Ebice</h1>' +
      '<p style="color:#a8b1c4;margin:0 0 18px">Ebice is only served from <b style="color:#f2f5fb">' + G.site +
      '</b>. This copy is unlicensed, it receives no updates, and the code it produces is not the code from the real engine.</p>' +
      '<a href="' + G.canonical + '" style="display:inline-block;padding:11px 22px;border-radius:9px;background:#6d5cff;' +
      'color:#fff;text-decoration:none;font-weight:600">Go to ' + G.site + '</a>' +
      '<p style="color:#6b7589;font-size:12px;margin-top:18px">Own a mirror of this site by mistake? Add your hostname to the ' +
      'allowlist in the page <code>&lt;head&gt;</code> and open <a href="' + G.canonical + 'dmca/" style="color:#a8b1c4">' +
      G.site + '/dmca</a> to get it licensed.</p></div>';
    document.body.appendChild(box);
  }

  var style = document.createElement('style');
  style.textContent = [
    /* selection + callout only on the app chrome, never inside the editors */
    '.brand,.tagline,.pane-head,.panel-title,.presets,.stats,.section-block h2,.section-sub,.features .feature,.steps .step,.foot{',
    '  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none}',
    '.brand a,.opt-desc,.faq-a,[data-ebice-copy]{-webkit-user-select:text;user-select:text}',
    'img{-webkit-user-drag:none}',
    IS_APP ? 'html[data-ebice-origin="verified"] .engine-pill::after{content:" \u00b7 origin verified";color:var(--ok)}' : '',
    /* printed or PDF-ed copies always carry the source, and never carry the ads */
    '@media print{',
    '  .ad-slot,.actions,.bg{display:none!important}',
    '  body{background:#fff!important;color:#000!important}',
    '  body::before{content:"' + watermarkText() + '";position:fixed;left:50%;top:42%;transform:translate(-50%,-50%) rotate(-28deg);',
    '    font:700 34px/1.2 system-ui,sans-serif;letter-spacing:.06em;opacity:.14;pointer-events:none;z-index:9999;white-space:nowrap}',
    '}'
  ].join('\n');
  document.head.appendChild(style);

  function watermarkText() {
    return 'Ebice \u2014 ' + G.site + ' \u00a9 ' + new Date().getFullYear();
  }

  /* --- 2. frame lock ------------------------------------------------------ *
   * GitHub Pages cannot send X-Frame-Options or CSP frame-ancestors, so this
   * is the only framing defence available on the current host. SECURITY.md
   * shows the header version to switch on once Cloudflare fronts the domain.    */
  if (!G.dev) {
    var framed = false;
    try { framed = window.self !== window.top; } catch (e) { framed = true; }
    if (framed && !parentAllowed()) {
      root.setAttribute('data-ebice-guard', 'framed');
      try { window.top.location.replace(location.href); } catch (e) { /* cross-origin: fall through */ }
      // If we cannot break out, refuse to render the interface at all.
      root.style.setProperty('visibility', 'hidden', 'important');
    }
  }

  function parentAllowed() {
    var anc = location.ancestorOrigins;               // WebKit
    if (anc && anc.length) {
      for (var i = 0; i < anc.length; i++) {
        var h = (anc[i].split('//')[1] || '').split('/')[0].toLowerCase();
        if (!h || G.allows(h)) return true;
      }
      return false;
    }
    var ref = document.referrer;                      // everyone else
    if (!ref) return false;
    var host = (ref.split('//')[1] || '').split('/')[0].toLowerCase();
    return !host || G.allows(host);
  }

  /* --- 3. ad publisher lock ----------------------------------------------- *
   * The classic way to rob a static site is to copy it and swap the publisher
   * id. Anything that is not our own id gets removed before AdSense can bid.    */
  var EXPECTED = G.adClient;
  if (EXPECTED) {
    var tamperedAds = 0;
    Array.prototype.forEach.call(document.querySelectorAll('ins.adsbygoogle'), function (ins) {
      var client = ins.getAttribute('data-ad-client');
      if (client && client !== EXPECTED) { ins.parentNode && ins.parentNode.removeChild(ins); tamperedAds++; }
    });
    Array.prototype.forEach.call(document.querySelectorAll('script[src*="adsbygoogle"],script[src*="googlesyndication"]'), function (s) {
      var m = /client=(ca-pub-\d+)/.exec(s.getAttribute('src') || '');
      if (m && m[1] !== EXPECTED) { s.parentNode && s.parentNode.removeChild(s); tamperedAds++; }
    });
    var meta = document.querySelector('meta[name="google-adsense-account"]');
    if (meta && meta.getAttribute('content').replace(/\s/g, '') !== EXPECTED) tamperedAds++;
    if (tamperedAds) {
      // Neutralise the queue so late injections from the removed tag cannot fire.
      window.adsbygoogle = { push: function () {} };
      console.warn('[ebice] removed ' + tamperedAds + ' ad slot(s) with a publisher id that is not ' + EXPECTED + '.');
      // Whoever edited the publisher id did it to bill for traffic that is not
      // theirs. Give them our canonical page instead — including the notice.
      try { window.top.location.replace(G.canonical + '?from=ad-hijack'); } catch (e) {}
    }
  }

  /* --- 4. copy guards (app pages only) ------------------------------------ */
  if (IS_APP) {
    document.addEventListener('contextmenu', function (e) {
      if (!e.target || !e.target.closest) return;
      if (e.target.closest('textarea,input,a,.ad-slot,.faq-a,[data-ebice-copy],button')) return;
      e.preventDefault();
      flashHint();
    });

    // Anyone who highlights the marketing copy gets the source appended to it.
    document.addEventListener('copy', function (e) {
      var node = (window.getSelection || function () {})();
      var text = node ? String(node) : '';
      if (!e.clipboardData || text.length < 120) return;
      if (e.target.closest && e.target.closest('textarea,input')) return;   // never touch user code
      e.preventDefault();
      e.clipboardData.setData('text/plain', text + '\n\n— ' + G.site + ' — Ebice, Roblox Lua obfuscator');
    });

    // Right-click feedback that does not depend on the app's own toast helper.
    var hintTimer = null;
    function flashHint() {
      var hint = document.getElementById('ebice-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'ebice-hint';
        hint.setAttribute('role', 'status');
        hint.textContent = 'Right-click is disabled on Ebice’s interface — your code and output stay copyable.';
        hint.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:1000;max-width:340px;padding:11px 16px;' +
          'border-radius:12px;background:#12151c;border:1px solid #232833;border-left:3px solid #6d5cff;' +
          'color:#a8b1c4;font:500 12.5px/1.5 system-ui,sans-serif;box-shadow:0 20px 50px -12px rgba(0,0,0,.7);' +
          'opacity:0;transform:translateY(10px);transition:opacity .2s,transform .2s;pointer-events:none';
        document.body.appendChild(hint);
      }
      requestAnimationFrame(function () { hint.style.opacity = '1'; hint.style.transform = 'none'; });
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function () { hint.style.opacity = '0'; hint.style.transform = 'translateY(10px)'; }, 2400);
    }
  }
})();

# Security and AdSense deployment checklist

This repository is served as a static GitHub Pages site. The source changes cannot configure account-level Google AdSense settings or HTTP response headers.

## Before enabling ads for visitors

1. In AdSense, confirm `ebice.site` is added, verified, and approved. Keep the existing `ads.txt` publisher line in the site root and confirm it is reachable at `https://ebice.site/ads.txt` after deployment.
2. Configure Auto ads in the AdSense account. The site has the AdSense loader and publisher ID; the manual placements intentionally do not use fake slot IDs. If you want manual placements, create ad units in AdSense and insert their actual slot IDs.
3. Configure and publish a Google-certified CMP in AdSense for EEA, UK and Swiss traffic. Verify consent, withdrawal, and non-personalized ad behavior in a real browser. A text notice or custom banner is not a substitute for a certified CMP.
4. Complete and verify the site's privacy disclosures, including the actual data controller's legal name/address, retention practices, CMP details, and contact channel. Do not publish generic or inaccurate legal assertions.
5. Check AdSense policy compliance and ensure ads are clearly distinguishable from controls and content. Never click your own ads or encourage clicks.

## Hosting/security limitations

GitHub Pages does not let a repository define arbitrary HTTP response headers. The `referrer` meta policy on the main page is a best-effort browser setting, not a replacement for server headers. If stronger headers are required, put the domain behind a host/CDN that supports them (for example CSP, HSTS, `X-Content-Type-Options`, `Permissions-Policy`, and `frame-ancestors`), and test compatibility with Google ads and the inline scripts before enforcing CSP. Keep dependencies minimal and review changes before deployment.

A security contact is published at `/.well-known/security.txt`.

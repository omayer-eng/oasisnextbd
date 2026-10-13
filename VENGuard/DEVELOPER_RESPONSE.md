# VenGuard website — developer response to the brief

Plain-language answers to every **[Developer to advise]** item in the brief, what is already built,
and what still needs the founders.

---

## 1. What is built now (Phase 1 front end)

| Brief item | Status |
|---|---|
| Homepage, all 13 sections in the brief's order (Part 4) | ✅ Built. The “Voices from the field” section appears automatically once a real quote with written permission is added |
| Home product page, How it works, Pre-order, Landlords & restaurants, Dealers, About, FAQ, Contact | ✅ Built |
| Legal: Privacy, Terms, Refund policy, Cookies (Bangla + English) | ✅ Drafts, clearly marked “awaiting lawyer review” |
| Agro & Marine “coming soon” with waitlist (Phase 2 item) | ✅ Built early, it was cheap to add |
| Guides page | ✅ Placeholder listing the first articles “in expert review” (Phase 2 fills it) |
| Bangla default, English toggle, choice remembered, own titles/descriptions per language, `hreflang`, sitemap | ✅ |
| Brand colours, Inter + Noto Sans Bengali, 16 px+ body, light theme, Air Line motif, 2 px line icons | ✅ |
| Logo replaceable from one file | ✅ `src/templates/partials/logo.html` |
| Claims rule switches (“designed to” + “testing in progress” until confirmed) | ✅ `site.json → claims` |
| Certification marks only when granted | ✅ `site.json → certifications_granted` |
| Pre-order flow: form → save lead → payment → confirmation page with order number | ✅ Front end done; payment needs the SSLCommerz account (see 3) |
| Failed or abandoned payment keeps the lead | ✅ Lead is saved *before* payment |
| One form skeleton for pre-order, landlord/restaurant, dealer, waitlist, contact | ✅ |
| Bangladesh mobile validation (accepts Bangla digits, +880, spaces) | ✅ |
| Company-owned database, email alert per lead, CSV export, Google Sheets | ✅ `backend/` |
| Bangla SMS confirmation | ✅ Hook ready; needs an SMS gateway account |
| Tracking plan (Part 8): sources, dealer/QR codes, device, connection, language, scroll, FAQ, every CTA by position, funnel, form drop-off field, payment errors | ✅ Events built; needs GA4/Meta/Clarity IDs |
| Cookie notice with a real choice; no personal data to analytics | ✅ |
| Weekly 8-number email | ✅ Apps Script trigger |
| Product showcase: swipeable photos + short silent clips (as on hydra-bd.com) | ✅ Add clips via `site.json → gallery` |
| Downloadable fact sheet | ✅ English PDF generated from `site.json` (`src/make_factsheet.py`) |
| Accessibility: contrast, alt text, keyboard, skip link, visible focus, errors not shown by colour alone | ✅ |

The design takes the calm, spacious, editorial feel of the Verkada restaurants page the founders
liked (big confident headlines, rounded image panels, quiet cards, tabs for audiences), and the
product-in-pictures storytelling of hydra-bd.com, while keeping to the VenGuard Brand Guidelines.

## 2. Timeline (brief Part 3)

| Phase | Estimate |
|---|---|
| Phase 1 remaining (accounts, real content & photos, payment go-live, testing on real phones) | **2–3 weeks** after the founders deliver the Part 14 decisions. The front end is already done, so the original 4–6 weeks is comfortably met |
| Phase 2 (guides, dealer map, fact sheets in Bangla, referral codes) | 3–4 weeks |
| Phase 3 (customer login, Connected dashboard, alerts) | Separate project, quoted once the device's connectivity design is fixed |

## 3. Payment: direct merchant integration or aggregator?

**Recommendation: SSLCommerz (aggregator) for launch.**

- One integration gives bKash, Nagad, Rocket, Visa/Mastercard/Amex and internet banking.
  Direct bKash + Nagad + card integrations would be three separate approvals and three builds.
- Typical set-up: **1–3 weeks** for merchant approval (trade licence, TIN, bank account, website with
  refund/privacy/terms pages, which are already built). Ask SSLCommerz for the current set-up fee and
  per-transaction rate; aggregators in Bangladesh commonly charge about 2–3% per transaction.
- The integration is already written (`backend/apps-script/Code.gs`). Payments are **verified with
  SSLCommerz's server** before an order is marked paid. We never touch card numbers or wallet PINs.
- **Until the account is approved**, pre-orders still work: the lead is saved and the team collects
  the deposit by bKash/Nagad “Send Money/Payment” on a call. Nothing blocks launch.
- Later, if bKash becomes most of the volume, a direct bKash checkout can be added for a lower fee.

## 4. Speed target (brief Part 10)

**Measurable target:** on a budget Android phone (Moto G-class) over normal 4G,
*Largest Contentful Paint ≤ 2.5 s*, *Cumulative Layout Shift < 0.1*, total first-view weight **< 500 KB**,
and PageSpeed Insights mobile score ≥ 85.

Today: the homepage's first view is about **350 KB** in total (≈155 KB of our files plus ≈195 KB of web
fonts). There are no frameworks, no sliders and no heavy animation. Images are WebP with JPEG fallback,
sized for phones, and lazy-loaded below the fold. We will re-measure on real devices before launch.

## 5. Hosting and monthly cost

| Option | Monthly cost | Notes |
|---|---|---|
| **Cloudflare Pages (recommended)** | **Free** | Global network with edge locations close to Bangladesh, HTTPS, automatic deploy from GitHub, unlimited bandwidth on the free plan |
| GitHub Pages (current) | Free | Works today; fine for testing, less control over caching and headers |
| Google Sheet + Apps Script (leads) | Free | Within Google Workspace limits |
| Google Workspace (company email on the domain) | ~US$7 per user | Needed anyway for company email |
| Domain (`.com.bd` or `.com`) | ~BDT 1,500–3,000 per year | After the trademark check |
| SMS gateway | Pay as you go, roughly BDT 0.35–0.60 per Bangla SMS | Several local providers |
| Uptime monitor (UptimeRobot free) | Free | Emails/WhatsApp-style alerts when the site is down |

**Expected running cost at launch: under BDT 2,000/month plus SMS and payment fees.**

## 6. Technology choice, in plain words

- **The website is plain HTML, CSS and a little JavaScript.** Every web developer in the world can
  read it, and it loads fast on cheap phones. It isn't tied to any one company's product.
- **Pages are generated by a 100-line Python script with Jinja2** (a very common template tool),
  so each sentence is written once with its Bangla and English side by side, and every page gets
  its own proper Bangla and English address, title and description for Google.
- **Leads go to a Google Sheet the company owns**, through a short Google Apps Script. Free, simple,
  instant CSV export, and the team already knows how to use a spreadsheet.
- **Why not WordPress?** It is fine, but needs a server, plugins and security updates every month,
  and is usually slower on budget phones. We can move to a CMS later without redesigning (see 7).

Another developer can take this over in a day: `README.md` explains every folder.

## 7. Admin panel (brief Part 9): recommendation

| Need | Phase 1 answer | Later |
|---|---|---|
| See, search, filter, export pre-orders and enquiries; mark contacted / paid / refunded / installed | ✅ Google Sheet with a status dropdown and filters | Proper admin with Phase 3 |
| Email alert for every lead | ✅ | — |
| Separate accounts, roles, two-step login | ✅ Google accounts with 2-step verification; Sheet sharing as Editor/Viewer; protected ranges | Role-based admin in Phase 3 |
| Change price, turn Pre-order on/off | `site.json`, one line + publish (2 minutes) | Moves into the CMS |
| Manage dealers and dealer codes | A “Dealers” tab in the same Sheet; codes are any text such as `DH-042` used in `?dealer=` links | Dealer map in Phase 2 reads this tab |
| Edit Bangla/English text, photos, FAQ, guides without a developer | **Add Decap CMS (free)** in Phase 1b: a web editor at `/VENGuard/admin/` that edits `site.json` and the content files through GitHub logins | — |

We recommend adding Decap CMS in week 1–2 of the remaining Phase 1 work. It is free, open-source,
keeps the site fast, and gives the marketing team a form-based editor without a developer.

## 8. Testing on low-end phones and change requests

- Test devices: a ~BDT 10,000 Android (e.g. Symphony/Walton/Itel class), an older Samsung A-series,
  and an iPhone, on Grameenphone and Robi 4G and on throttled 3G; Chrome, Facebook in-app browser,
  and Opera Mini.
- Bangla rendering is checked on these devices, including conjunct letters (ক্ষ, ন্ত্র, স্ক, জ্ঞ).
  Screenshots from automated checks already show correct shaping with Noto Sans Bengali.
- Change requests: one shared list (Google Sheet or Trello). Each request gets a preview link before going live.

## 9. Ownership and handover (brief Part 11)

All accounts are created **in the company's name with founders as owners**: domain, Cloudflare, GitHub
organisation, Google Workspace, Google Sheet, GA4, Meta Business, Clarity, Search Console, SSLCommerz,
SMS gateway, UptimeRobot. Passwords go through a password manager (Bitwarden free/teams or 1Password).
At handover the founders receive this repository, `README.md`, `backend/README.md`, a recorded
training session, and an accounts-and-costs list. Bug-fix warranty: 60 days after launch.

## 10. What the founders need to give us (brief Part 14)

Everything below is marked in the code with `FOUNDERS:` or shown as `[ … ]` on the page.

- [ ] Domain name (then update `base_url` in `site.json`)
- [ ] Final Bangla tagline and native Bangla proofreading of **all** copy (the current Bangla is a careful draft)
- [ ] Logo (or approval of the text placeholder)
- [ ] Kit price, deposit and **final refund wording** (Pre-order page, Refund policy, FAQ)
- [ ] Which claims testing supports (CTO) → flip `claims` flags
- [ ] One sourced BFSCD statistic with year (homepage “The problem”)
- [ ] Real photos and 5–10 s silent clips with written consent (hero, “Fits your kitchen”, gallery)
- [ ] Real customer quotes with written permission (optional; section hides until then)
- [ ] The five founders' names and one-line backgrounds; exact wording of the BUET relationship
- [ ] WhatsApp number, phone, email, address, support hours (`site.json → contact`)
- [ ] Lawyer review of Privacy, Terms, Refund and Cookies pages
- [ ] Accounts: Google (Sheet, GA4, Search Console), Meta Business (Pixel), Clarity, SSLCommerz, SMS gateway

## 11. Launch checklist (brief Part 15) — current state

| Check | State |
|---|---|
| Every page in Bangla and English on a cheap Android and a computer | Built; real-device pass pending |
| Test pre-order: form → payment → confirmation → admin; failed payment keeps the lead | Form → save → confirmation tested in demo mode. Payment needs SSLCommerz sandbox credentials |
| Tracking events fire and reach the weekly dashboard | Events verified in `dataLayer`; needs tool IDs |
| Page speed meets target | ~350 KB first view; device measurement pending |
| WhatsApp/Facebook previews | Open Graph title, description and 1200×630 image on every page; check with Facebook Sharing Debugger after domain is live |
| Every claim checked against the claims rule | Done in copy; CTO sign-off needed |
| Legal pages live and reviewed | Live as drafts; lawyer review pending |
| Backups, security, uptime alert | Git history = code backup; Google Sheet version history = data backup; set up UptimeRobot at launch |
| Founders own every account; handover delivered | At launch |

## 12. Not included in this phase

Customer login and the Connected dashboard (Phase 3), the dealer locator map and guide articles
(Phase 2), Meta server-side events (Conversions API, recommended once the Pixel is live; can be
added to the Apps Script), and professional photography/video production.

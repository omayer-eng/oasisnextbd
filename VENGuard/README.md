# VenGuard website

Built to the **VenGuard Website Brief for the Developer (v1.0, October 2026)**.
Phase 1 launch site: calm, light, fast on cheap phones, Bangla first with English on a toggle.

Live path: `/VENGuard/` (Bangla) and `/VENGuard/en/` (English).

## What is where

```
VENGuard/
├── src/                         ← edit here
│   ├── site.json                ← price, deposit, pre-order on/off, contacts, claims, tracking IDs, gallery
│   ├── build.py                 ← builds every page in Bangla and English
│   ├── make_factsheet.py        ← rebuilds assets/docs/venguard-fact-sheet.pdf
│   └── templates/
│       ├── base.html            ← <head>, SEO tags, header/footer, cookie bar
│       ├── partials/logo.html   ← THE LOGO (replace in one file)
│       ├── partials/faq-list.html  ← all FAQ questions and answers
│       ├── partials/macros.html    ← icons, Air Line, Pre-order button
│       ├── partials/forms.html     ← the one form skeleton used by every form
│       └── pages/*.html         ← one file per page, both languages side by side
├── assets/css/venguard.css      ← brand colours, type, layout
├── assets/js/site.js            ← forms, menu, language memory, click/scroll tracking
├── assets/js/analytics.js       ← cookie consent + GA4 / Meta Pixel / Clarity (only after consent)
├── assets/img, assets/video, assets/docs
├── backend/                     ← company-owned leads database (Google Sheet + Apps Script)
├── DEVELOPER_RESPONSE.md        ← our answers to every [Developer to advise] item
└── index.html, en/, */index.html ← GENERATED. Do not edit by hand.
```

## Change something

1. Edit `src/site.json` or a template. Every piece of copy is written once with both languages:
   `{{ t("বাংলা লেখা", "English text") }}`.
2. Build: `pip install jinja2 && python3 src/build.py`
3. Commit and push. GitHub Pages publishes in about a minute.

Common edits:

| Task | Where |
|---|---|
| Change the deposit or show the kit price | `site.json → preorder` |
| Turn the Pre-order button off | `site.json → preorder.open: false` |
| A claim is now confirmed by testing (CTO) | `site.json → claims.*_confirmed: true` — the site drops “designed to” automatically |
| A certification is granted | `site.json → certifications_granted: ["BSTI"]` |
| Move the status timeline | `site.json → status_timeline` (`done` / `current` / `next`) |
| Add a real customer quote (with written permission) | `site.json → testimonials` (`quote_bn`, `quote_en`, `name_bn`, `name_en`, `age`, `area_bn`, `area_en`) — the section appears only when there is at least one |
| Add a photo or short silent clip to the product strip | `site.json → gallery.items` (see `assets/video/README.md`) |
| Replace the logo | `src/templates/partials/logo.html` |
| WhatsApp number, phone, email, hours | `site.json → contact` |
| Turn on analytics | `site.json → tracking` (IDs) |
| Connect the leads database | `site.json → endpoints.leads` (see `backend/README.md`) |

## Rules built into the site

- **Claims rule** — “closes in under 1 second”, “no power needed” and “no internet needed” show as
  “designed to … · Testing in progress” until the matching `claims` flag is set to `true`.
  Certification marks only appear when listed in `certifications_granted`.
- **No red/amber/green decoration**, no pop-ups, no fake urgency, no stock photos, no autoplay with sound.
  Short product clips are muted, play only while on screen, and are skipped on data-saver / slow
  networks / reduced-motion.
- **Privacy** — analytics load only after the visitor accepts; names, phones and emails are never
  sent to analytics (stripped in `analytics.js` as a safety net).
- **Attribution** — `?utm_source=…`, `?dealer=CODE` and `?qr=TAG` on any link are remembered for the
  visit and saved with the lead. Dealer QR stickers should point to e.g. `/VENGuard/?dealer=DH-042&qr=shop-sticker`.

## Tracking events (Part 8)

`cta_preorder_click` (with `position`), `whatsapp_click`, `call_click`, `email_click`, `factsheet_download`,
`faq_open`, `scroll_depth`, `video_play`, `audience_tab`, `language_switch`, `campaign_landing`,
`funnel_how_it_works`, `form_start`, `form_start_preorder`, `form_error` (field), `form_abandon` (last field),
`lead_submit` (form, kitchen type, units band), `lead_submit_error`, `payment_start`, `payment_fail`,
`deposit_paid`, `preorder_submitted_unpaid`. All go to `window.dataLayer` too.

Funnel in GA4 (Explore → Funnel): `page_view` → `funnel_how_it_works` → `form_start_preorder` → `lead_submit` → `deposit_paid`.

## Test locally

```
python3 src/build.py
cd .. && python3 -m http.server 8000   # open http://localhost:8000/VENGuard/
```
With no `endpoints.leads` set, forms run in demo mode: they work end to end and keep a copy in the
browser only (see `localStorage.vg_demo_leads`).

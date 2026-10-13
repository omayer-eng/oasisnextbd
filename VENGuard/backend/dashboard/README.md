# VenGuard team dashboard

The company-side web app: one place for the team to see and work every pre-order and enquiry.

- **Overview**: deposits paid, pre-orders, awaiting payment, paid rate, landlord/restaurant and dealer
  leads; submissions per day; pre-order funnel; sources, districts, dealer codes; a "Needs a call" list
  of anyone waiting more than a day.
- **Orders & leads**: search by name, phone, order number, area or dealer code; filter by type,
  status and district; open a lead to WhatsApp or call them, change the status
  (new → payment pending → contacted → deposit paid → installed, or refunded / not interested)
  and add team notes; export CSV.
- **Dealers**: dealer list with codes, leads, pre-orders and paid deposits per dealer; approve dealer
  applications from the website; QR sticker and tracking link for each dealer.
- **Settings & team** (founders): turn pre-orders on/off, set the kit price and a notice bar on the
  website; add or remove team members with a role; activity log of every change.

Roles: **founder** (everything), **support** (update orders and notes), **marketing** (view and export).

It runs on Google Apps Script on top of the same **VenGuard Leads** Google Sheet as the website
backend, so it is free, there is no server to maintain, sign-in is the team's own Google accounts
(with 2-step verification), and the Sheet stays the single source of truth.

`Index.html` also opens on its own in a browser with example data, for demos and design changes.

## Set up (once, about 10 minutes)

Do the website backend first (`../README.md`), so the VenGuard Leads Sheet exists.

1. Copy the Sheet's ID: it is the long part of its URL between `/d/` and `/edit`.
2. Go to <https://script.google.com> → **New project**. Name it `VenGuard Dashboard`.
3. Replace `Code.gs` with the contents of `Dashboard.gs`.
4. **+ → HTML**, name it `Index`, and paste the contents of `Index.html`.
5. **Project Settings** → tick *Show "appsscript.json"*; open it in the editor and paste `appsscript.json`.
6. **Project Settings → Script properties**: add `SHEET_ID` (from step 1) and `SITE_URL`
   (`https://oasisnextbd.github.io/OASIS_official_website/VENGuard`).
7. **Deploy → New deployment → Web app**: *Execute as: User accessing the web app*,
   *Who has access: Anyone with Google account*. Deploy and authorise.
8. Open the Web app URL. The first person to open it becomes a **founder**. Bookmark it.
9. In **Settings & team**, add each team member's Google email and role. The dashboard gives them
   access to the Sheet automatically.

Updating later: paste the new files, then **Deploy → Manage deployments → Edit → Version: New version**.
The URL stays the same.

## What the website reads from it

The **Settings** tab of the Sheet holds `preorder_open`, `kit_price_bdt`, `notice_bn`, `notice_en`.
The website endpoint (`../apps-script/Code.gs`, `doGet?settings`) shares only these non-personal values;
the site applies them within about 10 minutes (cached per visit). The endpoint also refuses new
pre-orders while `preorder_open` is off.

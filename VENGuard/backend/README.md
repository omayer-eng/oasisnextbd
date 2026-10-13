# VenGuard leads backend (Google Sheet + Apps Script)

This is the company-owned database for every pre-order and enquiry (brief 8.3). It costs nothing,
takes about 20 minutes to set up, and the founders own it from day one.

## Set up (once)

1. Signed in as the **company** Google account, create a Google Sheet called `VenGuard Leads`.
2. In the Sheet: **Extensions → Apps Script**. Delete the sample code and paste `apps-script/Code.gs`.
3. **Project Settings → Script properties** → add:
   | Property | Example |
   |---|---|
   | `ALERT_EMAILS` | `founders@venguard.com.bd,support@venguard.com.bd` |
   | `SITE_URL` | `https://venguard.com.bd` (no trailing slash) |
   | `SSLC_STORE_ID`, `SSLC_STORE_PASSWORD` | from SSLCommerz (leave empty until the merchant account is live) |
   | `SSLC_SANDBOX` | `true` while testing, then delete |
   | `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER_ID` | from your SMS gateway (optional) |
   | `GA4_PROPERTY_ID` | numeric GA4 property id (optional, for the weekly email) |
4. **Deploy → New deployment → Web app**. Execute as: *Me*. Who has access: *Anyone*. Copy the URL.
5. Paste the URL into `src/site.json` → `endpoints.leads`. If SSLCommerz is configured, set
   `endpoints.payment_enabled` to `true`. Run `python3 src/build.py`, commit and push.
6. In Apps Script run `setupWeeklyTrigger` once (accept the permissions prompt).
7. Optional for the weekly visits number: **Services → + → Google Analytics Data API**.

## Daily use (the interim admin panel)

- Every lead is one row. Use **Data → Create a filter** to search and filter.
- Change the `status` dropdown: `contacted`, `paid`, `refunded`, `installed`, …
- **File → Download → CSV** for a one-click export.
- Share the Sheet only with named team accounts that have 2-step verification on.
  Founders: *Editor*. Support: *Editor* on the Leads tab only (protect other ranges). Marketing: *Viewer*.

## How payment works

1. The visitor submits the pre-order form. The row is saved immediately with `status = payment_pending`.
2. If SSLCommerz is configured, the visitor is sent to the SSLCommerz page (bKash, Nagad, cards).
   We never see or store card numbers or wallet PINs.
3. SSLCommerz calls back (`?action=ipn`). The script **validates the payment with SSLCommerz's
   server** before marking the row `paid`, then sends the Bangla SMS.
4. Failed or abandoned payments keep the row so the team can call.

Until SSLCommerz is live, the thank-you page tells the customer the team will call to take the
deposit by bKash/Nagad manually.

## Moving on later

When the business outgrows a Sheet (Phase 3 customer area), export the CSV and import it into the
new database. The website only needs `endpoints.leads` changed to the new server's URL; the form
sends the same JSON fields as the Sheet's column names.

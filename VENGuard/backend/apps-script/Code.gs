/**
 * VenGuard leads backend — Google Apps Script bound to a Google Sheet the company owns.
 *
 * What it does (brief Parts 6, 8.3, 8.4, 9):
 *  - Receives every pre-order and enquiry from the website and saves it as a row.
 *  - Sends an instant email alert to the team.
 *  - Sends the customer a Bangla SMS confirmation (if an SMS gateway is configured).
 *  - Optionally starts an SSLCommerz payment (bKash, Nagad, cards) for the BDT 500 deposit
 *    and marks the row "paid" when SSLCommerz confirms it. The lead is saved BEFORE payment,
 *    so failed or abandoned payments never lose the lead.
 *  - Sends a weekly summary email with the eight numbers the founders asked for.
 *
 * The Sheet is the interim admin panel: filter, search, mark status (dropdown), export CSV.
 * Share it only with named Google accounts that have 2-step verification switched on.
 *
 * Set-up: see backend/README.md. Secrets live in Project Settings → Script properties,
 * never in this file:
 *   ALERT_EMAILS        comma-separated team emails
 *   SITE_URL            e.g. https://oasisnextbd.github.io/OASIS_official_website/VENGuard
 *   SSLC_STORE_ID, SSLC_STORE_PASSWORD, SSLC_SANDBOX ("true" while testing)   (optional)
 *   SMS_API_URL, SMS_API_KEY, SMS_SENDER_ID                                  (optional)
 *   GA4_PROPERTY_ID     numeric GA4 property id, for visits in the weekly email (optional)
 */

var SHEET_NAME = 'Leads';
var COLUMNS = [
  'submitted_at', 'order_id', 'form_type', 'status', 'name', 'phone', 'email', 'organisation',
  'area', 'district', 'kitchen_type', 'business_type', 'units', 'cylinder_brand', 'heard_from',
  'dealer_code', 'qr_tag', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
  'referrer', 'landing_page', 'page_url', 'lang', 'message', 'consent',
  'payment_status', 'payment_txn', 'payment_method', 'paid_at', 'team_notes'
];
var STATUSES = ['new', 'payment_pending', 'contacted', 'paid', 'refunded', 'installed', 'not_interested'];
var FORM_TYPES = ['preorder', 'enquiry', 'dealer', 'waitlist', 'contact'];

function prop(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }

/* ---------------- Website → Sheet ---------------- */
function doPost(e) {
  // SSLCommerz posts back here too (IPN and browser return).
  if (e.parameter && e.parameter.action) return handlePaymentCallback(e);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents || '{}');
    if (data.website) return json({ ok: true });                 // honeypot: silently drop spam
    if (FORM_TYPES.indexOf(data.form_type) < 0) return json({ ok: false, error: 'bad form' });
    var phone = String(data.phone || '').replace(/\D/g, '').replace(/^880/, '0');
    if (!/^01[3-9]\d{8}$/.test(phone)) return json({ ok: false, error: 'bad phone' });
    if (data.consent !== 'yes') return json({ ok: false, error: 'no consent' });
    data.phone = phone;
    if (isDuplicate(phone, data.form_type)) return json({ ok: true, order_id: data.order_id, duplicate: true });

    data.order_id = String(data.order_id || '').match(/^VG-\d{6}-[A-Z0-9]{4}$/) ? data.order_id : makeOrderId();
    data.status = data.form_type === 'preorder' ? 'payment_pending' : 'new';
    data.submitted_at = new Date();
    appendRow(data);
    alertTeam(data);
    if (data.form_type === 'preorder') sendCustomerSms(data, 'received');

    var res = { ok: true, order_id: data.order_id };
    if (data.form_type === 'preorder' && prop('SSLC_STORE_ID')) {
      try { res.payment_url = startPayment(data); } catch (err) { console.error(err); } // lead is already saved
    }
    return json(res);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return json({ ok: true, service: 'venguard-leads' }); }

function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(COLUMNS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build();
    sh.getRange(2, COLUMNS.indexOf('status') + 1, 5000, 1).setDataValidation(rule);
    sh.getRange(2, COLUMNS.indexOf('phone') + 1, 5000, 1).setNumberFormat('@'); // keep the leading 0
  }
  return sh;
}

function appendRow(d) {
  sheet().appendRow(COLUMNS.map(function (c) {
    var v = d[c] === undefined ? '' : d[c];
    return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;          // block formula injection
  }));
}

function isDuplicate(phone, formType) {
  var sh = sheet(), last = sh.getLastRow();
  if (last < 2) return false;
  var n = Math.min(200, last - 1);
  var rows = sh.getRange(last - n + 1, 1, n, COLUMNS.length).getValues();
  var cutoff = Date.now() - 10 * 60 * 1000;
  var pi = COLUMNS.indexOf('phone'), fi = COLUMNS.indexOf('form_type');
  return rows.some(function (r) { return String(r[pi]) === phone && r[fi] === formType && new Date(r[0]).getTime() > cutoff; });
}

function makeOrderId() {
  var d = Utilities.formatDate(new Date(), 'Asia/Dhaka', 'yyMMdd');
  return 'VG-' + d + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function findRow(orderId) {
  var sh = sheet(), last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, COLUMNS.indexOf('order_id') + 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] === orderId) return i + 2;
  return 0;
}

function setCells(row, obj) {
  var sh = sheet();
  Object.keys(obj).forEach(function (k) { sh.getRange(row, COLUMNS.indexOf(k) + 1).setValue(obj[k]); });
}

/* ---------------- Alerts ---------------- */
function alertTeam(d) {
  var to = prop('ALERT_EMAILS');
  if (!to) return;
  var label = { preorder: 'Pre-order', enquiry: 'Landlord/restaurant enquiry', dealer: 'Dealer registration', waitlist: 'Agro/Marine waitlist', contact: 'Contact message' }[d.form_type];
  var lines = ['name', 'phone', 'email', 'organisation', 'area', 'district', 'kitchen_type', 'business_type', 'units', 'cylinder_brand', 'dealer_code', 'utm_source', 'heard_from', 'message']
    .filter(function (k) { return d[k]; }).map(function (k) { return k + ': ' + d[k]; });
  MailApp.sendEmail({
    to: to,
    subject: '[VenGuard] ' + label + ' ' + d.order_id + ' — ' + (d.district || ''),
    body: lines.join('\n') + '\n\nOpen the sheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
  });
}

/** Bangla SMS via any Bangladeshi HTTP SMS gateway. Adjust the payload to your provider's API. */
function sendCustomerSms(d, kind) {
  var url = prop('SMS_API_URL');
  if (!url) return;
  var msg = kind === 'paid'
    ? 'VenGuard: ধন্যবাদ! আপনার ৳৫০০ জামানত পেয়েছি। অর্ডার নম্বর ' + d.order_id + '। জামানত পুরোটাই ফেরতযোগ্য।'
    : 'VenGuard: ধন্যবাদ! আপনার প্রি-অর্ডার পেয়েছি। অর্ডার নম্বর ' + d.order_id + '। আমাদের দল শীঘ্রই ফোন করবে।';
  try {
    UrlFetchApp.fetch(url, {
      method: 'post', muteHttpExceptions: true,
      payload: { api_key: prop('SMS_API_KEY'), senderid: prop('SMS_SENDER_ID'), number: '88' + d.phone, message: msg, type: 'unicode' }
    });
  } catch (err) { console.error('SMS failed', err); }
}

/* ---------------- SSLCommerz deposit payment (optional) ---------------- */
function scriptUrl() { return ScriptApp.getService().getUrl(); }

function startPayment(d) {
  var sandbox = prop('SSLC_SANDBOX') === 'true';
  var base = sandbox ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
  var cb = scriptUrl() + '?action=';
  var r = UrlFetchApp.fetch(base + '/gwprocess/v4/api.php', {
    method: 'post', muteHttpExceptions: true,
    payload: {
      store_id: prop('SSLC_STORE_ID'), store_passwd: prop('SSLC_STORE_PASSWORD'),
      total_amount: '500', currency: 'BDT', tran_id: d.order_id,
      success_url: cb + 'return', fail_url: cb + 'return', cancel_url: cb + 'return', ipn_url: cb + 'ipn',
      cus_name: d.name, cus_phone: d.phone, cus_email: d.email || 'noemail@venguard.example',
      cus_add1: d.area || 'N/A', cus_city: d.district || 'Dhaka', cus_country: 'Bangladesh',
      shipping_method: 'NO', product_name: 'VenGuard Home pre-order deposit', product_category: 'Deposit', product_profile: 'non-physical-goods',
      value_a: d.lang || 'bn'
    }
  });
  var j = JSON.parse(r.getContentText());
  if (j.status !== 'SUCCESS' || !j.GatewayPageURL) throw new Error('SSLCommerz init failed: ' + r.getContentText());
  return j.GatewayPageURL;
}

/** Ask SSLCommerz whether a payment is really valid (never trust the browser). */
function validatePayment(valId) {
  var sandbox = prop('SSLC_SANDBOX') === 'true';
  var base = sandbox ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
  var r = UrlFetchApp.fetch(base + '/validator/api/validationserverAPI.php?format=json' +
    '&val_id=' + encodeURIComponent(valId) + '&store_id=' + encodeURIComponent(prop('SSLC_STORE_ID')) +
    '&store_passwd=' + encodeURIComponent(prop('SSLC_STORE_PASSWORD')), { muteHttpExceptions: true });
  var j = JSON.parse(r.getContentText());
  return (j.status === 'VALID' || j.status === 'VALIDATED') && Number(j.amount) >= 500 ? j : null;
}

function handlePaymentCallback(e) {
  var p = e.parameter, orderId = p.tran_id || '', paid = false;
  var row = findRow(orderId);
  if (row && p.val_id) {
    var v = validatePayment(p.val_id);
    if (v && v.tran_id === orderId) {
      paid = true;
      setCells(row, { status: 'paid', payment_status: 'paid', payment_txn: v.bank_tran_id || v.val_id, payment_method: v.card_type || '', paid_at: new Date() });
      if (p.action === 'ipn') {
        var rowVals = sheet().getRange(row, 1, 1, COLUMNS.length).getValues()[0];
        sendCustomerSms({ order_id: orderId, phone: String(rowVals[COLUMNS.indexOf('phone')]) }, 'paid');
      }
    }
  }
  if (row && !paid) setCells(row, { payment_status: p.status ? String(p.status).toLowerCase() : 'failed' });
  if (p.action === 'ipn') return json({ ok: true });

  // Browser return: send the visitor to the thank-you page in their language.
  var lang = p.value_a === 'en' ? 'en/' : '';
  var url = prop('SITE_URL') + '/' + lang + 'pre-order/thank-you/?order=' + encodeURIComponent(orderId) + '&payment=' + (paid ? 'paid' : 'failed');
  return HtmlService.createHtmlOutput('<script>window.top.location.href=' + JSON.stringify(url) + ';</script>');
}

/* ---------------- Weekly summary (brief 8.4) ----------------
 * Run setupWeeklyTrigger() once. Sends every Sunday 9 a.m. Dhaka time. */
function setupWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'weeklySummary') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('weeklySummary').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(9).inTimezone('Asia/Dhaka').create();
}

function weeklySummary() {
  var to = prop('ALERT_EMAILS'); if (!to) return;
  var since = Date.now() - 7 * 24 * 3600 * 1000;
  var sh = sheet(), last = sh.getLastRow();
  var rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, COLUMNS.length).getValues()
    .filter(function (r) { return new Date(r[0]).getTime() >= since; });
  var col = function (r, k) { return r[COLUMNS.indexOf(k)]; };
  var pre = rows.filter(function (r) { return col(r, 'form_type') === 'preorder'; });
  var paid = pre.filter(function (r) { return col(r, 'payment_status') === 'paid'; }).length;
  var dealers = rows.filter(function (r) { return col(r, 'form_type') === 'dealer'; }).length;
  var biz = rows.filter(function (r) { return col(r, 'form_type') === 'enquiry'; }).length;
  var src = {};
  rows.forEach(function (r) { var s = col(r, 'utm_source') || col(r, 'heard_from') || col(r, 'referrer') || 'direct'; src[s] = (src[s] || 0) + 1; });
  var top = Object.keys(src).sort(function (a, b) { return src[b] - src[a]; }).slice(0, 3).map(function (k) { return k + ' (' + src[k] + ')'; });

  var visits = 'connect GA4_PROPERTY_ID', started = 'see GA4 (form_start_preorder)';
  if (prop('GA4_PROPERTY_ID') && typeof AnalyticsData !== 'undefined') {
    try {
      var rep = AnalyticsData.Properties.runReport({
        dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
        metrics: [{ name: 'sessions' }]
      }, 'properties/' + prop('GA4_PROPERTY_ID'));
      visits = rep.rows ? rep.rows[0].metricValues[0].value : '0';
      var ev = AnalyticsData.Properties.runReport({
        dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }], metrics: [{ name: 'eventCount' }],
        dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'form_start_preorder' } } }, dimensions: [{ name: 'eventName' }]
      }, 'properties/' + prop('GA4_PROPERTY_ID'));
      started = ev.rows ? ev.rows[0].metricValues[0].value : '0';
    } catch (err) { console.error(err); }
  }
  var conv = visits && !isNaN(visits) && Number(visits) > 0 ? (100 * paid / Number(visits)).toFixed(2) + '%' : 'n/a';
  var body = [
    'VenGuard — last 7 days', '',
    '1. Visits: ' + visits,
    '2. Pre-order forms started: ' + started,
    '3. Pre-orders submitted: ' + pre.length + '  ·  Deposits paid: ' + paid,
    '4. Conversion (deposits ÷ visits): ' + conv,
    '5. Top sources: ' + (top.join(', ') || '—'),
    '6. Dealer leads: ' + dealers,
    '7. Landlord & restaurant leads: ' + biz,
    '8. Page speed: see PageSpeed Insights → https://pagespeed.web.dev/analysis?url=' + encodeURIComponent(prop('SITE_URL') + '/'),
    '', 'Sheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
  ].join('\n');
  MailApp.sendEmail({ to: to, subject: '[VenGuard] Weekly numbers', body: body });
}

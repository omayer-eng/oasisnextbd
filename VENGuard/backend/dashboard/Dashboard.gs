/**
 * VenGuard team dashboard — server side (Google Apps Script web app).
 *
 * A separate Apps Script project from the website endpoint (Code.gs), deployed with
 *   Execute as: User accessing the web app   ·   Who has access: Anyone with a Google account
 * so every person signs in with their own Google account (2-step verification on) and can
 * only do what the shared "VenGuard Leads" Sheet already lets them do. On top of that,
 * the "Team" tab gives each person a role:
 *   founder   – everything, incl. dealers, site settings and team
 *   support   – leads: change status, add notes, export
 *   marketing – read-only view + export
 * Script property: SHEET_ID = the id of the VenGuard Leads spreadsheet (from its URL).
 */

var TABS = {
  leads: 'Leads',
  team: 'Team',
  dealers: 'Dealers',
  settings: 'Settings',
  activity: 'Activity'
};
var TEAM_COLS = ['email', 'name', 'role', 'active'];
var DEALER_COLS = ['code', 'shop_name', 'owner_name', 'phone', 'area', 'district', 'status', 'created_at', 'notes'];
var ACTIVITY_COLS = ['time', 'user', 'action', 'ref', 'detail'];
var LEAD_STATUSES = ['new', 'payment_pending', 'contacted', 'paid', 'refunded', 'installed', 'not_interested'];
var ROLES = ['founder', 'support', 'marketing'];
var CAN = {
  editLead: ['founder', 'support'],
  dealers: ['founder'],
  settings: ['founder'],
  team: ['founder']
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('VenGuard Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/* ---------------- helpers ---------------- */
function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID script property is not set.');
  return SpreadsheetApp.openById(id);
}
function tab_(name, cols) {
  var ss = ss_(), sh = ss.getSheetByName(name);
  if (!sh && cols) {
    sh = ss.insertSheet(name);
    sh.appendRow(cols);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
  }
  return sh;
}
function rows_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), head = v.shift();
  return v.map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, j) { o[h] = r[j] instanceof Date ? r[j].toISOString() : r[j]; });
    return o;
  });
}
function me_() {
  var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('Please sign in with your Google account.');
  var sh = tab_(TABS.team, TEAM_COLS);
  var team = rows_(sh);
  if (!team.length) {
    // First visit: the first person in becomes the founder.
    sh.appendRow([email, '', 'founder', true]);
    return { email: email, name: '', role: 'founder' };
  }
  var m = team.filter(function (t) { return String(t.email).toLowerCase() === email && t.active !== false; })[0];
  if (!m) throw new Error('Your account (' + email + ') is not on the VenGuard team list. Ask a founder to add you.');
  return { email: email, name: m.name || '', role: ROLES.indexOf(m.role) >= 0 ? m.role : 'marketing' };
}
function need_(user, what) {
  if (CAN[what].indexOf(user.role) < 0) throw new Error('Your role (' + user.role + ') cannot do this.');
}
function log_(user, action, ref, detail) {
  tab_(TABS.activity, ACTIVITY_COLS).appendRow([new Date(), user.email, action, ref || '', detail || '']);
}
function settings_() {
  var o = {};
  rows_(tab_(TABS.settings, ['key', 'value'])).forEach(function (r) { o[r.key] = r.value; });
  return o;
}

/* ---------------- API used by Index.html ---------------- */
function getBootstrap() {
  var user = me_();
  var activity = rows_(tab_(TABS.activity, ACTIVITY_COLS)).slice(-200).reverse();
  return {
    user: user,
    leads: rows_(ss_().getSheetByName(TABS.leads)),
    dealers: rows_(tab_(TABS.dealers, DEALER_COLS)),
    settings: settings_(),
    team: user.role === 'founder' ? rows_(tab_(TABS.team, TEAM_COLS)) : [],
    activity: activity,
    siteUrl: PropertiesService.getScriptProperties().getProperty('SITE_URL') || '',
    statuses: LEAD_STATUSES,
    generatedAt: new Date().toISOString()
  };
}

function updateLead(orderId, changes) {
  var user = me_(); need_(user, 'editLead');
  var sh = ss_().getSheetByName(TABS.leads);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idCol = head.indexOf('order_id') + 1;
  var ids = sh.getRange(2, idCol, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  var row = 0;
  for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] === orderId) { row = i + 2; break; }
  if (!row) throw new Error('Order ' + orderId + ' was not found.');
  var allowed = ['status', 'team_notes', 'assigned_to'];
  var done = [];
  allowed.forEach(function (k) {
    if (changes[k] === undefined) return;
    if (k === 'status' && LEAD_STATUSES.indexOf(changes[k]) < 0) throw new Error('Unknown status.');
    var c = head.indexOf(k) + 1;
    if (!c) { c = head.length + 1; sh.getRange(1, c).setValue(k).setFontWeight('bold'); head.push(k); }
    sh.getRange(row, c).setValue(String(changes[k]).slice(0, 2000));
    done.push(k + (k === 'status' ? ' → ' + changes[k] : ''));
  });
  log_(user, 'lead_update', orderId, done.join(', '));
  return true;
}

function saveDealer(d) {
  var user = me_(); need_(user, 'dealers');
  var code = String(d.code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
  if (!code) throw new Error('A dealer code is needed, e.g. DH-042.');
  var sh = tab_(TABS.dealers, DEALER_COLS);
  var existing = rows_(sh).filter(function (r) { return String(r.code).toUpperCase() === code; })[0];
  var values = DEALER_COLS.map(function (c) {
    if (c === 'code') return code;
    if (c === 'created_at') return existing ? existing.created_at : new Date();
    return d[c] === undefined ? (existing ? existing[c] : '') : String(d[c]).slice(0, 500);
  });
  if (existing) sh.getRange(existing._row, 1, 1, values.length).setValues([values]);
  else sh.appendRow(values);
  log_(user, existing ? 'dealer_update' : 'dealer_add', code, d.shop_name || '');
  return code;
}

function saveSettings(s) {
  var user = me_(); need_(user, 'settings');
  var sh = tab_(TABS.settings, ['key', 'value']);
  var keys = ['preorder_open', 'kit_price_bdt', 'deposit_bdt', 'notice_bn', 'notice_en'];
  var cur = rows_(sh);
  keys.forEach(function (k) {
    if (s[k] === undefined) return;
    var r = cur.filter(function (x) { return x.key === k; })[0];
    if (r) sh.getRange(r._row, 2).setValue(s[k]); else sh.appendRow([k, s[k]]);
  });
  log_(user, 'settings_update', '', JSON.stringify(s));
  return settings_();
}

function saveTeamMember(m) {
  var user = me_(); need_(user, 'team');
  var email = String(m.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (ROLES.indexOf(m.role) < 0) throw new Error('Choose a role.');
  var sh = tab_(TABS.team, TEAM_COLS);
  var r = rows_(sh).filter(function (x) { return String(x.email).toLowerCase() === email; })[0];
  var vals = [email, m.name || '', m.role, m.active !== false];
  if (r) sh.getRange(r._row, 1, 1, 4).setValues([vals]); else sh.appendRow(vals);
  // Give them access to the Sheet itself (needed because the dashboard runs as them).
  try {
    if (m.active === false) { ss_().removeEditor(email); ss_().removeViewer(email); }
    else if (m.role === 'marketing') ss_().addViewer(email); else ss_().addEditor(email);
  } catch (e) { console.warn(e); }
  log_(user, 'team_update', email, m.role + (m.active === false ? ' (removed)' : ''));
  return rows_(sh);
}

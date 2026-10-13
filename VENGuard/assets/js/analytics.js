/* VenGuard tracking (brief Part 8).
 * - Nothing third-party loads until the visitor accepts analytics cookies.
 * - Tool IDs come from src/site.json -> assets/js/config.js; empty ID = tool off.
 * - Never send personal data (name, phone, email) to analytics. vgTrack() strips
 *   any parameter whose name looks personal, as a safety net.
 * - Every event also goes to window.dataLayer so Google Tag Manager can be added later.
 */
(function () {
  "use strict";
  var CFG = (window.VG_CONFIG && window.VG_CONFIG.tracking) || {};
  var CONSENT_KEY = "vg_consent";
  var loaded = false;
  window.dataLayer = window.dataLayer || [];

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var PII = /name|phone|mobile|email|address|message/i;
  function clean(params) {
    var out = {};
    for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k) && !PII.test(k)) out[k] = params[k];
    return out;
  }

  // Map our event names to Meta standard events.
  var META_EVENTS = { form_start_preorder: "InitiateCheckout", lead_submit: "Lead", deposit_paid: "Purchase", contact_click: "Contact" };

  window.vgTrack = function (name, params) {
    params = clean(params || {});
    params.page = document.body ? document.body.getAttribute("data-page") : "";
    params.lang = document.documentElement.lang;
    window.dataLayer.push(Object.assign({ event: name }, params));
    if (!loaded) return;
    if (window.gtag) window.gtag("event", name, params);
    if (window.fbq) {
      var std = META_EVENTS[name];
      if (std) window.fbq("track", std, params); else window.fbq("trackCustom", name, params);
    }
    if (window.clarity) window.clarity("event", name);
  };

  function inject(src) { var s = document.createElement("script"); s.async = true; s.src = src; document.head.appendChild(s); }

  function connectionInfo() {
    var c = navigator.connection || {};
    return { connection_type: c.effectiveType || "unknown", save_data: !!c.saveData };
  }

  function loadTools() {
    if (loaded) return;
    loaded = true;
    var conn = connectionInfo();
    if (CFG.ga4_id) {
      inject("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(CFG.ga4_id));
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("consent", "update", { analytics_storage: "granted", ad_storage: "granted", ad_user_data: "granted", ad_personalization: "denied" });
      window.gtag("config", CFG.ga4_id, { anonymize_ip: true });
      window.gtag("set", "user_properties", { site_language: document.documentElement.lang, connection_type: conn.connection_type });
    }
    if (CFG.meta_pixel_id) {
      /* Standard Meta Pixel bootstrap */
      !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", CFG.meta_pixel_id);
      window.fbq("track", "PageView");
    }
    if (CFG.clarity_id) {
      (function (c, l, a, r, i, t, y) { c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); }; t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i; y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y); })(window, document, "clarity", "script", CFG.clarity_id);
    }
    // Replay events that happened before consent (e.g. page_view) to GA4 only.
    window.vgTrack("page_view_consented", conn);
  }

  function showBar(show) {
    var bar = document.getElementById("consent");
    if (bar) bar.classList.toggle("is-visible", show);
  }

  window.vgConsent = function (choice) {
    store(CONSENT_KEY, choice);
    showBar(false);
    if (choice === "granted") loadTools();
    else if (loaded) location.reload(); // withdrawing consent: reload without tools
  };

  document.addEventListener("DOMContentLoaded", function () {
    var choice = store(CONSENT_KEY);
    var anyTool = CFG.ga4_id || CFG.meta_pixel_id || CFG.clarity_id;
    if (choice === "granted") loadTools();
    else if (!choice && anyTool) showBar(true);
    document.addEventListener("click", function (e) {
      var c = e.target.closest("[data-consent]");
      if (c) { window.vgConsent(c.getAttribute("data-consent")); return; }
      if (e.target.closest("[data-consent-open]")) showBar(true);
    });
  });
})();

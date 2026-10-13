/* VenGuard site behaviour: menu, language memory, click/scroll tracking,
 * campaign + dealer attribution, and the shared lead/pre-order form handler. */
(function () {
  "use strict";
  var CFG = window.VG_CONFIG || {};
  var track = function (n, p) { if (window.vgTrack) window.vgTrack(n, p); };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------- Attribution: campaign tags, dealer code / QR tag ---------- */
  var ATTR_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "dealer", "qr"];
  (function captureAttribution() {
    var q = new URLSearchParams(location.search);
    var found = false;
    ATTR_KEYS.forEach(function (k) { if (q.get(k)) { ss("vg_" + k, q.get(k).slice(0, 80)); found = true; } });
    if (!ss("vg_landing")) {
      ss("vg_landing", location.pathname + location.search);
      ss("vg_referrer", document.referrer ? new URL(document.referrer).hostname : "direct");
    }
    if (found) track("campaign_landing", { source: ss("vg_utm_source") || "", dealer_code: ss("vg_dealer") || "", qr_tag: ss("vg_qr") || "" });
  })();

  document.addEventListener("DOMContentLoaded", function () {
    /* ---------- Mobile menu ---------- */
    var toggle = $(".menu-toggle"), nav = $("#site-nav");
    if (toggle && nav) toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    /* ---------- Language memory ---------- */
    $$("[data-lang-switch]").forEach(function (a) {
      a.addEventListener("click", function () {
        var l = a.getAttribute("data-lang-switch");
        ls("vg_lang", l);
        track("language_switch", { to: l });
      });
    });

    /* ---------- Click tracking: any element with data-track ---------- */
    document.addEventListener("click", function (e) {
      var el = e.target.closest("[data-track]");
      if (!el) return;
      track(el.getAttribute("data-track"), { position: el.getAttribute("data-position") || "" });
    });

    /* ---------- Audience tabs ---------- */
    $$("[data-tabs]").forEach(function (box) {
      var tabs = $$("[role=tab]", box);
      function select(tab, focus) {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute("aria-selected", on ? "true" : "false");
          t.tabIndex = on ? 0 : -1;
          document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
        });
        if (focus) tab.focus();
      }
      tabs.forEach(function (t, i) {
        t.addEventListener("click", function () { select(t); track("audience_tab", { tab: t.id }); });
        t.addEventListener("keydown", function (e) {
          var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
        });
      });
    });

    /* ---------- FAQ opens ---------- */
    $$("details[data-faq]").forEach(function (d) {
      d.addEventListener("toggle", function () { if (d.open) track("faq_open", { question_id: d.getAttribute("data-faq") }); });
    });

    /* ---------- Short silent clips: play only while on screen, and never on
       data-saver, slow connections or reduced-motion (then tap to play). ---------- */
    var conn = navigator.connection || {};
    var lite = conn.saveData || /(^|-)2g$|^3g$/.test(conn.effectiveType || "") ||
      (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    $$("video[data-inview-play]").forEach(function (v) {
      var fig = v.closest(".gallery-item");
      var play = function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); if (fig) fig.classList.add("is-playing"); };
      var btn = fig && $(".gallery-play", fig);
      if (btn) btn.addEventListener("click", play);
      if (lite || !("IntersectionObserver" in window)) return;
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) play(); else { v.pause(); if (fig) fig.classList.remove("is-playing"); } });
      }, { threshold: 0.6 }).observe(v);
    });

    /* ---------- Video plays ---------- */
    $$("video").forEach(function (v) {
      v.addEventListener("play", function () { track("video_play", { video: v.getAttribute("data-name") || v.currentSrc.split("/").pop() }); }, { once: true });
    });

    /* ---------- Scroll depth (25/50/75/100) ---------- */
    var marks = [25, 50, 75, 100], sent = {};
    var onScroll = function () {
      var h = document.documentElement, max = h.scrollHeight - h.clientHeight;
      var pct = max > 0 ? Math.round((h.scrollTop / max) * 100) : 100;
      marks.forEach(function (m) { if (pct >= m && !sent[m]) { sent[m] = 1; track("scroll_depth", { percent: m }); } });
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    /* ---------- Funnel step: how-it-works read ---------- */
    if (document.body.getAttribute("data-page") === "how-it-works") track("funnel_how_it_works");

    applyLiveSettings();
    $$("form[data-vg-form]").forEach(setupForm);
    setupThankYou();
  });

  /* ================= Live settings from the team dashboard =================
     Pre-order on/off, kit price and a notice bar. Cached for 10 minutes so
     pages stay fast; the static page is always complete without it. */
  function applyLiveSettings() {
    var url = CFG.endpoints && CFG.endpoints.leads;
    if (!url) return;
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem("vg_settings") || "null"); } catch (e) {}
    if (cached && Date.now() - cached.t < 6e5) return apply(cached.s);
    fetch(url + (url.indexOf("?") < 0 ? "?" : "&") + "settings=1").then(function (r) { return r.json(); }).then(function (s) {
      try { sessionStorage.setItem("vg_settings", JSON.stringify({ t: Date.now(), s: s })); } catch (e) {}
      apply(s);
    }).catch(function () {});
    function apply(s) {
      if (!s || !s.ok) return;
      var lang = document.documentElement.lang;
      if (String(s.preorder_open).toLowerCase() === "false") {
        var contact = ($(".nav a[href$='about/']") || {}).href ? $(".nav a[href$='about/']").href.replace(/about\/$/, "contact/") : "contact/";
        $$("[data-track='cta_preorder_click']").forEach(function (a) {
          a.textContent = lang === "bn" ? "আপডেট পেতে যোগাযোগ করুন" : "Get notified";
          a.setAttribute("href", contact); a.setAttribute("data-track", "cta_waitlist_click");
        });
        var form = $("form[data-vg-form='preorder']");
        if (form) form.outerHTML = '<div class="notice"><p class="mt-0">' + (lang === "bn" ? "প্রি-অর্ডার এই মুহূর্তে বন্ধ আছে। আপডেট পেতে যোগাযোগ করুন।" : "Pre-orders are paused right now. Contact us to be notified.") + ' <a href="' + contact + '">' + (lang === "bn" ? "যোগাযোগ" : "Contact") + "</a></p></div>";
      }
      var price = parseInt(s.kit_price_bdt, 10);
      if (price > 0) $$("[data-setting='kit_price']").forEach(function (el) {
        el.textContent = lang === "bn" ? "৳" + String(price.toLocaleString("en-US")).replace(/[0-9]/g, function (d) { return "০১২৩৪৫৬৭৮৯"[d]; }) : "BDT " + price.toLocaleString("en-US");
      });
      var note = lang === "bn" ? s.notice_bn : s.notice_en;
      if (note) {
        var bar = document.createElement("div");
        bar.className = "site-notice"; bar.setAttribute("role", "status");
        bar.innerHTML = '<div class="wrap"></div>'; bar.firstChild.textContent = note;
        var header = $(".site-header"); if (header) header.parentNode.insertBefore(bar, header.nextSibling);
      }
    }
  }

  /* ================= Forms ================= */
  var BN = "০১২৩৪৫৬৭৮৯";
  function toAscii(s) { return String(s || "").replace(/[০-৯]/g, function (d) { return BN.indexOf(d); }); }
  function normalisePhone(v) {
    var d = toAscii(v).replace(/[^\d+]/g, "");
    d = d.replace(/^\+?880/, "0").replace(/^\+?88(?=01)/, "");
    return d;
  }
  var VALIDATORS = {
    "bd-mobile": function (v) { return /^01[3-9]\d{8}$/.test(normalisePhone(v)); },
    "email": function (v) { return !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); },
    "units": function (v) { var n = parseInt(toAscii(v), 10); return n >= 1 && n <= 9999; },
    "units-optional": function (v) { if (!v) return true; var n = parseInt(toAscii(v), 10); return n >= 0 && n <= 99999; }
  };

  function orderId() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    var rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
    return "VG-" + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + "-" + rnd;
  }

  function fieldBox(el) { return el.closest(".field"); }
  function setError(el, msg) {
    var box = fieldBox(el); if (!box) return;
    var err = $(".field-error", box);
    box.classList.toggle("has-error", !!msg);
    if (err) err.textContent = msg || "";
    $$("input,select,textarea", box).forEach(function (i) { if (msg) i.setAttribute("aria-invalid", "true"); else i.removeAttribute("aria-invalid"); });
  }
  function validateField(el) {
    var box = fieldBox(el); if (!box) return true;
    var err = $(".field-error", box);
    var val = el.type === "checkbox" ? (el.checked ? "yes" : "") : el.type === "radio" ? ($("input[name='" + el.name + "']:checked", box) || {}).value || "" : el.value.trim();
    if (el.required && !val) { setError(el, err && err.getAttribute("data-msg-required")); return false; }
    var rule = el.getAttribute("data-validate");
    if (rule && val && VALIDATORS[rule] && !VALIDATORS[rule](val)) { setError(el, el.getAttribute("data-msg-invalid")); return false; }
    setError(el, "");
    return true;
  }

  function setupForm(form) {
    var type = form.getAttribute("data-vg-form");
    var started = false, submitted = false, lastField = "";
    var draftKey = "vg_draft_" + type;

    // Fill hidden attribution fields.
    var set = function (n, v) { var i = form.elements[n]; if (i && v) i.value = v; };
    ["utm_source", "utm_medium", "utm_campaign", "utm_content"].forEach(function (k) { set(k, ss("vg_" + k)); });
    set("qr_tag", ss("vg_qr"));
    set("landing_page", ss("vg_landing"));
    set("referrer", ss("vg_referrer"));
    set("lang", document.documentElement.lang);
    if (form.elements.dealer_code && ss("vg_dealer") && !form.elements.dealer_code.value) form.elements.dealer_code.value = ss("vg_dealer");

    // Restore a draft the visitor didn't finish (kept only in their own browser).
    try {
      var draft = JSON.parse(ls(draftKey) || "null");
      if (draft) Object.keys(draft).forEach(function (k) {
        var el = form.elements[k]; if (!el || el.type === "hidden") return;
        if (el.length && el[0] && el[0].type === "radio") { $$("input[name='" + k + "']", form).forEach(function (r) { r.checked = r.value === draft[k]; }); }
        else if (el.type !== "checkbox") el.value = draft[k];
      });
    } catch (e) {}

    form.addEventListener("focusin", function (e) {
      if (!started) {
        started = true;
        track("form_start", { form: type });
        if (type === "preorder") track("form_start_preorder", { form: type });
      }
      if (e.target.name) lastField = e.target.name;
    });
    form.addEventListener("change", function (e) {
      if (e.target.name) validateField(e.target);
      saveDraft();
    });
    form.addEventListener("focusout", function (e) {
      var el = e.target;
      if (el.name && el.type !== "radio" && (el.value || fieldBox(el) && fieldBox(el).classList.contains("has-error"))) validateField(el);
    });
    // Where do people stop? Report the last field touched if they leave without submitting.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden" && started && !submitted) track("form_abandon", { form: type, last_field: lastField });
    });

    function saveDraft() {
      var data = {};
      $$("input,select,textarea", form).forEach(function (el) {
        if (!el.name || el.type === "hidden" || el.name === "website" || el.type === "checkbox") return;
        if (el.type === "radio") { if (el.checked) data[el.name] = el.value; } else if (el.value) data[el.name] = el.value;
      });
      ls(draftKey, JSON.stringify(data));
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var status = $(".form-status", form), btn = $("button[type=submit]", form);
      var ok = true, firstBad = null;
      $$("input,select,textarea", form).forEach(function (el) {
        if (!el.name || el.type === "hidden") return;
        if (!validateField(el)) { ok = false; if (!firstBad) firstBad = el; track("form_error", { form: type, field: el.name }); }
      });
      if (!ok) {
        status.textContent = form.getAttribute("data-msg-check");
        status.classList.add("is-visible");
        firstBad.focus();
        return;
      }
      if (form.elements.website && form.elements.website.value) return; // spam honeypot

      var data = {};
      $$("input,select,textarea", form).forEach(function (el) {
        if (!el.name || el.name === "website") return;
        if ((el.type === "radio" || el.type === "checkbox") && !el.checked) return;
        data[el.name] = el.value.trim();
      });
      data.phone = normalisePhone(data.phone);
      if (data.units) data.units = toAscii(data.units);
      data.form_type = type;
      data.order_id = orderId();
      data.status = type === "preorder" ? "payment_pending" : "new";
      data.submitted_at = new Date().toISOString();
      data.page_url = location.pathname;

      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = btn.getAttribute("data-label-busy");
      submitted = true;

      sendLead(data).then(function (res) {
        try { localStorage.removeItem(draftKey); } catch (e2) {}
        // Analytics gets the type and position only — never the person's details.
        track("lead_submit", { form: type, kitchen_type: data.kitchen_type || "", units_band: band(data.units), has_dealer_code: !!data.dealer_code });
        if (type === "preorder") {
          var id = (res && res.order_id) || data.order_id;
          ss("vg_last_order", id);
          var payUrl = res && res.payment_url;
          if (CFG.endpoints && CFG.endpoints.payment_enabled && payUrl) {
            track("payment_start", { form: type });
            location.href = payUrl;
            return;
          }
          location.href = form.getAttribute("data-next") + "?order=" + encodeURIComponent(id) + "&payment=pending";
          return;
        }
        form.reset();
        status.textContent = form.getAttribute("data-msg-ok");
        status.classList.add("is-visible");
        btn.disabled = false; btn.textContent = label;
      }).catch(function () {
        submitted = false;
        track("lead_submit_error", { form: type });
        status.textContent = form.getAttribute("data-msg-fail");
        status.classList.add("is-visible");
        btn.disabled = false; btn.textContent = label;
      });
    });
  }

  function band(n) { n = parseInt(n, 10) || 0; return n <= 1 ? "1" : n <= 5 ? "2-5" : n <= 20 ? "6-20" : "21+"; }

  /* Save the lead to OUR database first (status payment_pending), so a failed
     or abandoned payment never loses it (brief Part 6). */
  function sendLead(data) {
    var url = CFG.endpoints && CFG.endpoints.leads;
    if (!url) {
      // Demo mode: no backend configured yet. Keep a copy in this browser only.
      try {
        var all = JSON.parse(localStorage.getItem("vg_demo_leads") || "[]");
        all.push(data); localStorage.setItem("vg_demo_leads", JSON.stringify(all));
      } catch (e) {}
      if (window.console) console.info("[VenGuard] Demo mode: set endpoints.leads in src/site.json to save leads.", data);
      return Promise.resolve({ ok: true, order_id: data.order_id });
    }
    // text/plain avoids a CORS preflight, which Google Apps Script cannot answer.
    return fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(data) })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { if (!j || j.ok === false) throw new Error("rejected"); return j; });
  }

  /* ================= Thank-you page ================= */
  function setupThankYou() {
    var box = $("[data-thank-you]"); if (!box) return;
    var q = new URLSearchParams(location.search);
    var id = q.get("order") || ss("vg_last_order") || "—";
    var state = q.get("payment") || "pending"; // paid | pending | failed (set by the payment callback)
    if (["paid", "pending", "failed"].indexOf(state) < 0) state = "pending";
    $$("[data-order-id]").forEach(function (el) { el.textContent = id; });
    $$("[data-state]", box).forEach(function (el) { el.hidden = el.getAttribute("data-state") !== state; });
    if (state === "paid") track("deposit_paid", { value: CFG.deposit_bdt || 500, currency: "BDT" });
    else if (state === "failed") track("payment_fail", {});
    else track("preorder_submitted_unpaid", {});
  }
})();

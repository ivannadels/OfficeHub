/* ==========================================================================
   OfficeHub — Entry drawer (manual entry + edit), vanilla JS, no dependencies.
   Used by the Time Tracker and the Calendar.

   OfficeHubEntryDrawer.open({
     case_options: [...],          // required — fills the Case dropdown
     entry: { ...time_entry },     // optional — pass an existing entry to edit it
     defaults: { date, time, case, user_name },   // optional — prefill a new entry
     recent_cases: [...],          // optional — quick-pick chips under Case
     purpose_options: [...]        // optional — quick-pick chips under Purpose
   });

   When the person saves, one event is emitted (same channel as the tracker):
     document.addEventListener("officehub:action", (e) => {
       if (e.detail.action !== "entry-save") return;
       const entry = e.detail.entry;
       //   { entry_id (null when new), date "YYYY-MM-DD", time "HH:MM",
       //     purpose, case, notes, voice_note, user_name, created_at }
       const { draft_email, add_to_calendar, voice_file } = e.detail.value;
       // voice_file is the File picked with "upload audio" (or null).
       // Save it, set created_at / updated_at on your side, then re-render.
     });
   When editing, the Delete button emits "entry-delete" with the entry.
   The voice-note record button emits "voice-note-record-start" / "voice-note-record-stop".
   ========================================================================== */

(function () {
  "use strict";

  var DEFAULT_PURPOSES = ["Client call", "Research", "Drafting", "Court appearance", "Review", "Admin"];
  var NOTES_MAX = 500;

  var MARKUP =
    '<div class="oh-drawer-backdrop" hidden>' +
    ' <aside class="oh-drawer" role="dialog" aria-modal="true" aria-labelledby="oh-drawer-title">' +
    '  <header class="oh-drawer__head">' +
    '   <div>' +
    '    <div class="oh-eyebrow" data-el="eyebrow">Manual entry</div>' +
    '    <h2 class="oh-drawer__title" id="oh-drawer-title" data-el="title">New time entry</h2>' +
    '    <div class="oh-drawer__by" data-el="by"></div>' +
    '   </div>' +
    '   <button type="button" class="oh-icon-btn" data-el="close" aria-label="Close">' +
    '    <svg class="oh-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
    '   </button>' +
    '  </header>' +
    '  <form class="oh-drawer__body" data-el="form" novalidate>' +
    '   <div class="oh-field">' +
    '    <label class="oh-field__label" for="oh-f-case">Case</label>' +
    '    <div class="oh-select-wrap" data-el="caseWrap"><select class="oh-input" id="oh-f-case" name="case" required></select></div>' +
    '    <div class="oh-chips" data-el="recent"></div>' +
    '   </div>' +
    '   <div class="oh-grid-2">' +
    '    <div class="oh-field">' +
    '     <label class="oh-field__label" for="oh-f-date">Date</label>' +
    '     <input class="oh-input oh-input--mono" id="oh-f-date" name="date" type="date" required>' +
    '    </div>' +
    '    <div class="oh-field">' +
    '     <label class="oh-field__label" for="oh-f-time">Time</label>' +
    '     <div class="oh-input-group">' +
    '      <input class="oh-input oh-input--mono" id="oh-f-time" name="time" type="time" step="300" required>' +
    '      <button type="button" class="oh-btn oh-btn--soft" data-el="now">Now</button>' +
    '     </div>' +
    '    </div>' +
    '   </div>' +
    '   <div class="oh-field">' +
    '    <label class="oh-field__label" for="oh-f-purpose">Purpose</label>' +
    '    <input class="oh-input" id="oh-f-purpose" name="purpose" type="text" autocomplete="off" maxlength="100" required>' +
    '    <div class="oh-chips" data-el="purposes"></div>' +
    '   </div>' +
    '   <div class="oh-field">' +
    '    <div class="oh-field__row">' +
    '     <label class="oh-field__label" for="oh-f-notes">Notes</label>' +
    '     <span class="oh-field__count" data-el="count" aria-live="polite"></span>' +
    '    </div>' +
    '    <textarea class="oh-input" id="oh-f-notes" name="notes" rows="3" maxlength="' + NOTES_MAX + '"></textarea>' +
    '   </div>' +
    '   <div class="oh-field">' +
    '    <span class="oh-field__label">Voice note</span>' +
    '    <div class="oh-voice">' +
    '     <button type="button" class="oh-voice__btn" data-el="record" aria-pressed="false" aria-label="Record voice note">' +
    '      <svg class="oh-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>' +
    '     </button>' +
    '     <div class="oh-voice__text">' +
    '      <strong data-el="voiceTitle">Add a voice note (optional)</strong>' +
    '      <span data-el="voiceHelp">Record or <button type="button" class="oh-link-btn" data-el="upload">upload audio</button>. It is transcribed and kept with this entry.</span>' +
    '     </div>' +
    '     <button type="button" class="oh-link-btn" data-el="removeVoice" hidden>Remove</button>' +
    '     <input type="file" accept="audio/*" data-el="file" hidden>' +
    '    </div>' +
    '   </div>' +
    '   <fieldset class="oh-checks">' +
    '    <legend class="oh-field__label">After saving</legend>' +
    '    <label class="oh-check"><input type="checkbox" name="draft_email" checked> Draft a follow-up email</label>' +
    '    <label class="oh-check"><input type="checkbox" name="add_to_calendar"> Add to calendar</label>' +
    '   </fieldset>' +
    '  </form>' +
    '  <footer class="oh-drawer__foot">' +
    '   <span class="oh-hint"><kbd class="oh-kbd">Ctrl</kbd> + <kbd class="oh-kbd">Enter</kbd> to save</span>' +
    '   <div class="oh-drawer__foot-actions">' +
    '    <button type="button" class="oh-btn oh-btn--danger" data-el="delete" hidden>Delete</button>' +
    '    <button type="button" class="oh-btn oh-btn--outline" data-el="cancel">Cancel</button>' +
    '    <button type="button" class="oh-btn oh-btn--solid" data-el="save">Save entry</button>' +
    '   </div>' +
    '  </footer>' +
    ' </aside>' +
    '</div>';

  var root, el = {}, form, ctx = null, lastFocus = null;

  function pad(n) { return String(n).padStart(2, "0"); }
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function nowHHMM() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function emit(action, entry, value) {
    document.dispatchEvent(new CustomEvent("officehub:action", { detail: { action: action, entry: entry || null, value: value } }));
  }
  function caseColor(name) {
    var i = ctx ? ctx.case_options.indexOf(name) : -1;
    return String(((i < 0 ? 5 : i) % 6) + 1);
  }

  function build() {
    var wrap = document.createElement("div");
    wrap.innerHTML = MARKUP;
    root = wrap.firstElementChild;
    document.body.appendChild(root);
    root.querySelectorAll("[data-el]").forEach(function (n) { el[n.dataset.el] = n; });
    form = el.form;

    el.close.addEventListener("click", close);
    el.cancel.addEventListener("click", close);
    el.save.addEventListener("click", save);
    el["delete"].addEventListener("click", function () {
      if (!ctx || !ctx.entry) return;
      var entry = ctx.entry;
      close();
      emit("entry-delete", entry);
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); save(); });
    root.addEventListener("mousedown", function (e) { if (e.target === root) close(); });
    root.addEventListener("keydown", onKey);

    form.elements["case"].addEventListener("change", function () {
      el.caseWrap.dataset.color = caseColor(this.value);
      syncChips(el.recent, this.value);
    });
    form.elements.purpose.addEventListener("input", function () { syncChips(el.purposes, this.value); });
    form.elements.notes.addEventListener("input", updateCount);
    el.now.addEventListener("click", function () {
      form.elements.date.value = todayISO();
      form.elements.time.value = nowHHMM();
    });

    el.record.addEventListener("click", function () {
      var on = el.record.getAttribute("aria-pressed") !== "true";
      el.record.setAttribute("aria-pressed", on ? "true" : "false");
      el.record.setAttribute("aria-label", on ? "Stop recording" : "Record voice note");
      el.voiceTitle.textContent = on ? "Recording…" : voiceTitle();
      emit(on ? "voice-note-record-start" : "voice-note-record-stop", ctx && ctx.entry);
    });
    el.upload.addEventListener("click", function () { el.file.click(); });
    el.file.addEventListener("change", function () {
      ctx.voice_file = el.file.files[0] || null;
      renderVoice();
    });
    el.removeVoice.addEventListener("click", function () {
      ctx.voice_note = null;
      ctx.voice_file = null;
      el.file.value = "";
      renderVoice();
    });
  }

  function chipRow(container, label, values, onPick) {
    container.innerHTML = "";
    if (!values.length) { container.hidden = true; return; }
    container.hidden = false;
    if (label) {
      var l = document.createElement("span");
      l.className = "oh-chips__label";
      l.textContent = label;
      container.appendChild(l);
    }
    values.forEach(function (v) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "oh-chip";
      b.textContent = v;
      b.dataset.value = v;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () { onPick(v); });
      container.appendChild(b);
    });
  }
  function syncChips(container, value) {
    container.querySelectorAll(".oh-chip").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.value === value ? "true" : "false");
    });
  }
  function updateCount() {
    el.count.textContent = form.elements.notes.value.length + " / " + NOTES_MAX;
  }
  function voiceTitle() {
    if (ctx.voice_file) return ctx.voice_file.name;
    if (ctx.voice_note) return "Voice note attached";
    return "Add a voice note (optional)";
  }
  function renderVoice() {
    el.voiceTitle.textContent = voiceTitle();
    el.removeVoice.hidden = !(ctx.voice_note || ctx.voice_file);
  }

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); return; }
    if (e.key === "Tab") {                       // keep focus inside the drawer
      var f = root.querySelectorAll('button:not([hidden]), input:not([type="file"]), select, textarea');
      var list = Array.prototype.filter.call(f, function (n) { return !n.disabled && n.offsetParent !== null; });
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function open(opts) {
    if (!root) build();
    opts = opts || {};
    var entry = opts.entry || null;
    var d = opts.defaults || {};
    ctx = {
      case_options: Array.isArray(opts.case_options) ? opts.case_options : [],
      entry: entry,
      voice_note: entry ? entry.voice_note || null : null,
      voice_file: null,
      user_name: (entry && entry.user_name) || d.user_name || ""
    };

    el.eyebrow.textContent = entry ? "Edit entry" : "Manual entry";
    el.title.textContent = entry ? (entry.purpose || "Edit time entry") : "New time entry";
    el.by.textContent = ctx.user_name ? "Logged as " + ctx.user_name : "";
    el.save.textContent = entry ? "Save changes" : "Save entry";
    el["delete"].hidden = !entry;

    // Case
    var sel = form.elements["case"];
    sel.innerHTML = "";
    var current = (entry && entry["case"]) || d["case"] || ctx.case_options[0] || "";
    var opts2 = ctx.case_options.slice();
    if (current && opts2.indexOf(current) < 0) opts2.unshift(current);
    opts2.forEach(function (name) {
      var o = document.createElement("option");
      o.value = name; o.textContent = name;
      if (name === current) o.selected = true;
      sel.appendChild(o);
    });
    el.caseWrap.dataset.color = caseColor(current);
    chipRow(el.recent, "Recent", (opts.recent_cases || []).slice(0, 3), function (v) {
      sel.value = v;
      sel.dispatchEvent(new Event("change"));
    });
    syncChips(el.recent, current);

    // Date / time / purpose / notes
    form.elements.date.value = (entry && entry.date) || d.date || todayISO();
    form.elements.time.value = String((entry && entry.time) || d.time || nowHHMM()).slice(0, 5);
    form.elements.purpose.value = (entry && entry.purpose) || d.purpose || "";
    chipRow(el.purposes, "", opts.purpose_options || DEFAULT_PURPOSES, function (v) {
      form.elements.purpose.value = v;
      syncChips(el.purposes, v);
    });
    syncChips(el.purposes, form.elements.purpose.value);
    form.elements.notes.value = (entry && entry.notes) || "";
    updateCount();

    // Voice + options
    el.file.value = "";
    el.record.setAttribute("aria-pressed", "false");
    renderVoice();
    form.elements.draft_email.checked = !entry;
    form.elements.add_to_calendar.checked = false;
    form.querySelectorAll("[aria-invalid]").forEach(function (n) { n.removeAttribute("aria-invalid"); });

    lastFocus = document.activeElement;
    root.hidden = false;
    document.body.style.overflow = "hidden";
    (entry ? form.elements.notes : sel).focus();
  }

  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function save() {
    var bad = null;
    ["case", "date", "time", "purpose"].forEach(function (name) {
      var f = form.elements[name];
      var ok = String(f.value).trim() !== "";
      if (ok) f.removeAttribute("aria-invalid"); else { f.setAttribute("aria-invalid", "true"); bad = bad || f; }
    });
    if (bad) { bad.focus(); bad.reportValidity && bad.setCustomValidity("Please fill this in"); bad.reportValidity(); bad.setCustomValidity(""); return; }

    var e = ctx.entry || {};
    var out = {
      entry_id: e.entry_id != null ? e.entry_id : null,
      date: form.elements.date.value,
      time: form.elements.time.value,
      purpose: form.elements.purpose.value.trim(),
      "case": form.elements["case"].value,
      notes: form.elements.notes.value.trim(),
      voice_note: ctx.voice_note,
      user_name: ctx.user_name,
      created_at: e.created_at || null
    };
    emit("entry-save", out, {
      draft_email: form.elements.draft_email.checked,
      add_to_calendar: form.elements.add_to_calendar.checked,
      voice_file: ctx.voice_file
    });
    close();
  }

  window.OfficeHubEntryDrawer = { open: open, close: close };
})();

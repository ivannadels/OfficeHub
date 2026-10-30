/* ==========================================================================
   OfficeHub — Calendar, week time grid (vanilla JS, no dependencies)

   OfficeHubCalendar.render({
     time_entries: [{ entry_id, date, time, purpose, case, notes,
                      voice_note, user_name, created_at, updated_at }],
     case_options: ["Case A", "Case B", ...],
     active: "calendar",       // matches data-page on a sidebar link
     user_name: "J. Rivera"    // optional — enables "Only my entries" and prefills the drawer
   });
   OfficeHubCalendar.goTo("2035-04-04");   // jump to the week containing a date

   Entries have a start time but no duration, so each one is drawn as a
   30-minute block at its start time. Entries that overlap sit side by side.
   The grid shows 8 AM – 6 PM and grows to fit earlier or later entries.

   Events (same channel as the tracker):
     "memo" | "email"  — from the entry popover, with the entry
     "entry-save"      — from the drawer (Edit, New entry, or clicking an empty slot)
   ========================================================================== */

(function () {
  "use strict";

  var DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var DEFAULT_START = 8, DEFAULT_END = 18, BLOCK_MIN = 30;

  var state = {
    time_entries: [], case_options: [], active: null, user_name: "",
    weekStart: null, miniMonth: null, hidden: {}, voiceOnly: false, mineOnly: false, openId: null
  };
  var $ = function (id) { return document.getElementById(id); };

  // ---------- date helpers ----------
  function pad(n) { return String(n).padStart(2, "0"); }
  function parseDate(iso) { var p = String(iso).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function toISO(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); }
  function minutesOf(t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  function formatTime(t, short) {
    var mins = minutesOf(t); if (mins == null) return t || "";
    var h = Math.floor(mins / 60), m = pad(mins % 60);
    return ((h % 12) || 12) + ":" + m + (short ? "" : (h < 12 ? " AM" : " PM"));
  }
  function hourLabel(h) { return ((h % 12) || 12) + (h < 12 || h === 24 ? " AM" : " PM"); }
  function rangeLabel(a, b) {
    var o = { month: "short", day: "numeric" };
    if (a.getFullYear() !== b.getFullYear())
      return a.toLocaleDateString(undefined, Object.assign({ year: "numeric" }, o)) + " – " + b.toLocaleDateString(undefined, Object.assign({ year: "numeric" }, o));
    if (a.getMonth() !== b.getMonth())
      return a.toLocaleDateString(undefined, o) + " – " + b.toLocaleDateString(undefined, o) + ", " + b.getFullYear();
    return a.toLocaleDateString(undefined, o) + " – " + b.getDate() + ", " + b.getFullYear();
  }
  function hourPx() {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--oh-hour"));
    return v || 56;
  }

  // ---------- data helpers ----------
  function allCases() {
    var list = state.case_options.slice();
    state.time_entries.forEach(function (e) { if (e["case"] && list.indexOf(e["case"]) < 0) list.push(e["case"]); });
    return list;
  }
  function caseColor(name) {
    var i = allCases().indexOf(name);
    return String(((i < 0 ? 5 : i) % 6) + 1);
  }
  function visible(e) {
    if (state.hidden[e["case"]]) return false;
    if (state.voiceOnly && !e.voice_note) return false;
    if (state.mineOnly && state.user_name && e.user_name !== state.user_name) return false;
    return minutesOf(e.time) != null;
  }
  function weekDates() { var out = []; for (var i = 0; i < 7; i++) out.push(toISO(addDays(state.weekStart, i))); return out; }
  function entriesIn(dates, filtered) {
    return state.time_entries.filter(function (e) { return dates.indexOf(e.date) >= 0 && (!filtered || visible(e)); });
  }
  function recentCases() {
    var seen = [];
    state.time_entries.slice()
      .sort(function (a, b) { return String(b.updated_at || "").localeCompare(String(a.updated_at || "")); })
      .forEach(function (e) { if (e["case"] && seen.indexOf(e["case"]) < 0) seen.push(e["case"]); });
    return seen;
  }
  function emit(action, entry, value) {
    document.dispatchEvent(new CustomEvent("officehub:action", { detail: { action: action, entry: entry || null, value: value } }));
  }
  function openDrawer(entry, defaults) {
    closePop();
    if (!window.OfficeHubEntryDrawer) { emit(entry ? "edit" : "manual-entry", entry, defaults); return; }
    window.OfficeHubEntryDrawer.open({
      case_options: state.case_options,
      recent_cases: recentCases(),
      entry: entry || null,
      defaults: Object.assign({ user_name: state.user_name }, defaults || {})
    });
  }

  // ---------- sidebar nav ----------
  function renderNav() {
    document.querySelectorAll(".oh-nav-link").forEach(function (a) {
      if (a.dataset.page === state.active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  // ---------- mini month ----------
  function renderMini() {
    var m = state.miniMonth, grid = $("cal-mini");
    $("cal-mini-title").textContent = m.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    grid.innerHTML = "";
    ["M", "T", "W", "T", "F", "S", "S"].forEach(function (l) {
      var s = document.createElement("span"); s.className = "oh-mini__dow"; s.textContent = l; s.setAttribute("aria-hidden", "true"); grid.appendChild(s);
    });
    var start = mondayOf(m), todayISO = toISO(new Date()), week = weekDates();
    for (var i = 0; i < 42; i++) {
      var d = addDays(start, i), iso = toISO(d);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "oh-mini__day" +
        (d.getMonth() !== m.getMonth() ? " oh-mini__day--out" : "") +
        (week.indexOf(iso) >= 0 ? " oh-mini__day--week" : "") +
        (iso === todayISO ? " oh-mini__day--today" : "");
      b.textContent = d.getDate();
      b.dataset.date = iso;
      b.setAttribute("aria-label", d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }));
      b.addEventListener("click", function () { goTo(this.dataset.date); });
      grid.appendChild(b);
    }
  }

  // ---------- case filters ----------
  function renderFilters() {
    var box = $("cal-cases"), week = entriesIn(weekDates(), false);
    box.innerHTML = "";
    allCases().forEach(function (name) {
      var count = week.filter(function (e) { return e["case"] === name; }).length;
      var label = document.createElement("label"); label.className = "oh-filter";
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !state.hidden[name];
      cb.addEventListener("change", function () { state.hidden[name] = !cb.checked; renderWeek(); });
      var dot = document.createElement("span"); dot.className = "oh-dot"; dot.dataset.color = caseColor(name); dot.setAttribute("aria-hidden", "true");
      var n = document.createElement("span"); n.className = "oh-filter__name"; n.textContent = name;
      var c = document.createElement("span"); c.className = "oh-filter__count"; c.textContent = count || ""; c.setAttribute("aria-label", count + " this week");
      label.append(cb, dot, n, c);
      box.appendChild(label);
    });
    $("cal-mine-wrap").hidden = !state.user_name;
  }

  // ---------- week grid ----------
  function layoutDay(list) {
    // Greedy column packing for overlapping 30-minute blocks.
    var items = list.map(function (e) { var s = minutesOf(e.time); return { e: e, s: s, end: s + BLOCK_MIN }; })
      .sort(function (a, b) { return a.s - b.s; });
    var clusters = [], cur = null;
    items.forEach(function (it) {
      if (!cur || it.s >= cur.maxEnd) { cur = { cols: [], items: [], maxEnd: 0 }; clusters.push(cur); }
      var col = cur.cols.findIndex(function (end) { return end <= it.s; });
      if (col < 0) { col = cur.cols.length; cur.cols.push(0); }
      cur.cols[col] = it.end;
      it.col = col;
      cur.items.push(it);
      cur.maxEnd = Math.max(cur.maxEnd, it.end);
    });
    clusters.forEach(function (c) { c.items.forEach(function (it) { it.n = c.cols.length; }); });
    return items;
  }

  function renderWeek() {
    closePop();
    var dates = weekDates(), grid = $("cal-grid"), H = hourPx();
    var list = entriesIn(dates, true);
    var todayISO = toISO(new Date());

    $("cal-range").textContent = rangeLabel(state.weekStart, addDays(state.weekStart, 6));
    $("cal-count").textContent = list.length + (list.length === 1 ? " entry" : " entries") + " this week";

    var start = DEFAULT_START, end = DEFAULT_END;
    list.forEach(function (e) {
      var s = minutesOf(e.time);
      start = Math.min(start, Math.floor(s / 60));
      end = Math.max(end, Math.ceil((s + BLOCK_MIN) / 60));
    });
    var height = (end - start) * H;

    grid.innerHTML = "";
    var corner = document.createElement("div"); corner.className = "oh-wg__corner"; grid.appendChild(corner);

    dates.forEach(function (iso, i) {
      var d = parseDate(iso), head = document.createElement("div");
      head.className = "oh-wg__head" + (iso === todayISO ? " oh-wg__head--today" : "");
      var dow = document.createElement("span"); dow.className = "oh-wg__dow"; dow.textContent = DOW[i];
      var num = document.createElement("span"); num.className = "oh-wg__date"; num.textContent = d.getDate();
      head.append(dow, num);
      grid.appendChild(head);
    });

    var hours = document.createElement("div");
    hours.className = "oh-wg__hours"; hours.style.height = height + "px"; hours.setAttribute("aria-hidden", "true");
    for (var h = start; h < end; h++) {
      var lab = document.createElement("span"); lab.className = "oh-wg__hour";
      lab.style.top = ((h - start) * H) + "px"; lab.textContent = hourLabel(h);
      hours.appendChild(lab);
    }
    grid.appendChild(hours);

    dates.forEach(function (iso, i) {
      var col = document.createElement("div");
      col.className = "oh-wg__col" + (i >= 5 ? " oh-wg__col--weekend" : "") + (iso === todayISO ? " oh-wg__col--today" : "");
      col.style.height = height + "px";
      col.dataset.date = iso;
      col.setAttribute("role", "group");
      col.setAttribute("aria-label", parseDate(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));

      layoutDay(list.filter(function (e) { return e.date === iso; })).forEach(function (it) {
        var e = it.e, b = document.createElement("button");
        b.type = "button"; b.className = "oh-ev";
        b.dataset.color = caseColor(e["case"]);
        b.dataset.entryId = e.entry_id;
        b.setAttribute("aria-expanded", "false");
        b.setAttribute("aria-label", formatTime(e.time) + ", " + (e.purpose || "") + ", " + (e["case"] || ""));
        b.title = formatTime(e.time) + " · " + (e.purpose || "") + " · " + (e["case"] || "");
        b.style.top = ((it.s - start * 60) / 60 * H + 1) + "px";
        b.style.left = "calc(" + (it.col * 100 / it.n) + "% + 3px)";
        b.style.width = "calc(" + (100 / it.n) + "% - 6px)";
        var t = document.createElement("span"); t.className = "oh-ev__time"; t.textContent = formatTime(e.time, true);
        var p = document.createElement("span"); p.className = "oh-ev__title"; p.textContent = e.purpose || "";
        b.append(t, p);
        b.addEventListener("click", function (ev) { ev.stopPropagation(); togglePop(e, b); });
        col.appendChild(b);
      });

      if (iso === todayISO) {
        var now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
        if (nm >= start * 60 && nm <= end * 60) {
          var line = document.createElement("div"); line.className = "oh-wg__now"; line.setAttribute("aria-hidden", "true");
          line.style.top = ((nm - start * 60) / 60 * H) + "px";
          col.appendChild(line);
        }
      }

      col.addEventListener("click", function (ev) {
        if (ev.target !== col) return;
        var y = ev.clientY - col.getBoundingClientRect().top;
        var mins = start * 60 + Math.floor(y / H * 60 / BLOCK_MIN) * BLOCK_MIN;
        openDrawer(null, { date: iso, time: pad(Math.floor(mins / 60)) + ":" + pad(mins % 60) });
      });
      grid.appendChild(col);
    });

    renderFilters();
    renderMini();
  }

  // ---------- popover ----------
  var pop, popEls = {}, popEntry = null, popAnchor = null;

  function togglePop(entry, anchor) {
    if (state.openId === entry.entry_id) { closePop(); return; }
    closePop();
    popEntry = entry; popAnchor = anchor; state.openId = entry.entry_id;
    anchor.setAttribute("aria-expanded", "true");

    popEls.dot.dataset.color = caseColor(entry["case"]);
    popEls["case"].textContent = entry["case"] || "";
    popEls.purpose.textContent = entry.purpose || "";
    popEls.when.textContent = parseDate(entry.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " · " + formatTime(entry.time);
    popEls.notes.textContent = entry.notes || "";
    popEls.notes.hidden = !entry.notes;
    popEls.meta.textContent = [entry.user_name ? "Logged by " + entry.user_name : "", entry.voice_note ? "voice note attached" : ""].filter(Boolean).join(" · ");
    popEls.memo.disabled = !entry.voice_note;
    popEls.memo.title = entry.voice_note ? "" : "No voice note for this entry";

    // Fixed to the viewport so it is never clipped by the scrolling grid.
    pop.hidden = false;
    var ar = anchor.getBoundingClientRect(), W = window.innerWidth, Hh = window.innerHeight, pw = pop.offsetWidth, ph = pop.offsetHeight;
    var left = ar.right + 8;
    if (left + pw > W - 8) left = ar.left - pw - 8;
    if (left < 8) left = Math.max(8, Math.min(W - pw - 8, ar.left));
    var top = ar.top - 10;
    if (left === ar.left || (left < ar.right && left + pw > ar.left)) top = ar.bottom + 8;   // no room beside: go below
    top = Math.max(8, Math.min(top, Hh - ph - 8));
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    popEls.close.focus();
  }

  function closePop() {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    state.openId = null;
    if (popAnchor) { popAnchor.setAttribute("aria-expanded", "false"); if (document.activeElement && pop.contains(document.activeElement)) popAnchor.focus(); }
    popEntry = null; popAnchor = null;
  }

  // ---------- navigation ----------
  function goTo(iso) {
    var d = parseDate(iso);
    state.weekStart = mondayOf(d);
    state.miniMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    renderWeek();
  }
  function shiftWeek(n) {
    state.weekStart = addDays(state.weekStart, 7 * n);
    var mid = addDays(state.weekStart, 3);
    state.miniMonth = new Date(mid.getFullYear(), mid.getMonth(), 1);
    renderWeek();
  }

  var bound = false;
  function bind() {
    $("cal-prev").addEventListener("click", function () { shiftWeek(-1); });
    $("cal-next").addEventListener("click", function () { shiftWeek(1); });
    $("cal-today").addEventListener("click", function () { goTo(toISO(new Date())); });
    $("cal-mini-prev").addEventListener("click", function () { state.miniMonth = new Date(state.miniMonth.getFullYear(), state.miniMonth.getMonth() - 1, 1); renderMini(); });
    $("cal-mini-next").addEventListener("click", function () { state.miniMonth = new Date(state.miniMonth.getFullYear(), state.miniMonth.getMonth() + 1, 1); renderMini(); });
    $("cal-voice").addEventListener("change", function () { state.voiceOnly = this.checked; renderWeek(); });
    $("cal-mine").addEventListener("change", function () { state.mineOnly = this.checked; renderWeek(); });
    $("cal-new").addEventListener("click", function () {
      var today = new Date(), inWeek = weekDates().indexOf(toISO(today)) >= 0;
      openDrawer(null, { date: inWeek ? toISO(today) : toISO(state.weekStart) });
    });

    pop = $("cal-pop");
    pop.querySelectorAll("[data-pop]").forEach(function (n) { popEls[n.dataset.pop] = n; });
    popEls.close.addEventListener("click", closePop);
    popEls.memo.addEventListener("click", function () { emit("memo", popEntry); });
    popEls.email.addEventListener("click", function () { emit("email", popEntry); });
    popEls.edit.addEventListener("click", function () { var e = popEntry; openDrawer(e); });
    document.addEventListener("mousedown", function (ev) {
      if (!pop.hidden && !pop.contains(ev.target) && !(ev.target.closest && ev.target.closest(".oh-ev"))) closePop();
    });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closePop(); });
    window.addEventListener("resize", closePop);
    window.addEventListener("scroll", closePop, true);
  }

  window.OfficeHubCalendar = {
    render: function (data) {
      data = data || {};
      state.time_entries = Array.isArray(data.time_entries) ? data.time_entries : [];
      state.case_options = Array.isArray(data.case_options) ? data.case_options : [];
      state.active = data.active || null;
      state.user_name = data.user_name || "";
      if (!state.weekStart) {
        var t = new Date();
        state.weekStart = mondayOf(t);
        state.miniMonth = new Date(t.getFullYear(), t.getMonth(), 1);
      }
      if (!bound) { bind(); bound = true; }
      renderNav();
      renderWeek();
    },
    goTo: function (iso) { goTo(iso); }
  };
})();

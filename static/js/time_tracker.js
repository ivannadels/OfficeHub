/* ==========================================================================
   OfficeHub — Time Tracker renderer (vanilla JS, no dependencies)

   OfficeHubTimeTracker.render({
     time_entries: [{ entry_id, date, time, purpose, case, notes,
                      voice_note, user_name, created_at, updated_at }],
     case_options: ["Case A", "Case B", ...],
     active: "time_tracker"   // matches data-page on a sidebar link
   });

   Expected formats
     date        "YYYY-MM-DD"
     time        "HH:MM" (24h) — shown as "9:00 AM"; any other string is shown as-is
     voice_note  transcript text or URL; null/empty disables the Memo button
     created_at / updated_at  ISO timestamps (shown in the row tooltip)

   User actions are emitted as one DOM event you can listen for:
     document.addEventListener("officehub:action", (e) => {
       const { action, entry, value } = e.detail;
       // action: "memo" | "email" | "calendar" | "case-change"
       //         | "manual-entry" | "export" | "record-start" | "record-stop"
     });
   ========================================================================== */

(function () {
  "use strict";

  var state = { time_entries: [], case_options: [], active: null, selectedDate: null };
  var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // ---------- helpers ----------
  function parseDate(iso) {                 // "YYYY-MM-DD" -> local Date (no timezone shift)
    var p = String(iso).split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function toISO(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function formatTime(t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(t || "");
    if (!m) return t || "";
    var h = Number(m[1]);
    return ((h % 12) || 12) + ":" + m[2] + " " + (h < 12 ? "AM" : "PM");
  }
  function formatStamp(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  function caseColor(name) {                // stable colour slot 1–6 from position in case_options
    var i = state.case_options.indexOf(name);
    return String(((i < 0 ? 5 : i) % 6) + 1);
  }
  function emit(action, entry, value) {
    document.dispatchEvent(new CustomEvent("officehub:action", { detail: { action: action, entry: entry || null, value: value } }));
  }
  function entriesOn(iso) {
    return state.time_entries
      .filter(function (e) { return e.date === iso; })
      .sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
  }

  // ---------- sidebar ----------
  function renderNav() {
    document.querySelectorAll(".oh-nav-link").forEach(function (a) {
      if (a.dataset.page === state.active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  // ---------- week strip (Mon–Sun around the selected date) ----------
  function renderWeek() {
    var wrap = document.getElementById("oh-week");
    var sel = parseDate(state.selectedDate);
    var monday = new Date(sel);
    monday.setDate(sel.getDate() - ((sel.getDay() + 6) % 7));
    wrap.innerHTML = "";

    for (var i = 0; i < 7; i++) {
      var d = new Date(monday);
      d.setDate(monday.getDate() + i);
      var iso = toISO(d);
      var count = entriesOn(iso).length;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "oh-day";
      btn.setAttribute("aria-pressed", iso === state.selectedDate ? "true" : "false");
      btn.dataset.date = iso;
      btn.innerHTML =
        '<span class="oh-day__name"></span><span class="oh-day__date"></span><span class="oh-day__hours"></span>';
      btn.children[0].textContent = DAY_NAMES[d.getDay()];
      btn.children[1].textContent = d.getDate();
      if (count) {
        btn.children[2].textContent = count;
        var unit = document.createElement("span");
        unit.className = "oh-day__unit";
        unit.textContent = count === 1 ? " entry" : " entries";
        btn.children[2].appendChild(unit);
      } else {
        btn.children[2].textContent = "—";
      }
      btn.addEventListener("click", function () {
        state.selectedDate = this.dataset.date;
        renderWeek();
        renderRows();
      });
      wrap.appendChild(btn);
    }
  }

  // ---------- entries table ----------
  function renderRows() {
    var body = document.getElementById("oh-rows");
    var tpl = document.getElementById("oh-row-template");
    var list = entriesOn(state.selectedDate);
    var sel = parseDate(state.selectedDate);

    document.getElementById("oh-day-title").textContent =
      sel.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    document.getElementById("oh-day-total").textContent =
      list.length + (list.length === 1 ? " entry" : " entries");

    body.innerHTML = "";
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="5" class="oh-empty">No entries for this day.</td></tr>';
      return;
    }

    list.forEach(function (entry) {
      var row = tpl.content.firstElementChild.cloneNode(true);
      var f = function (name) { return row.querySelector('[data-field="' + name + '"]'); };

      row.dataset.entryId = entry.entry_id;
      row.title = "Created " + formatStamp(entry.created_at) + " · Updated " + formatStamp(entry.updated_at);

      f("time").textContent = formatTime(entry.time);
      f("purpose").textContent = entry.purpose || "";
      f("user_name").textContent = entry.user_name ? "by " + entry.user_name : "";
      f("notes").textContent = entry.notes || "";

      // Case dropdown, filled from case_options
      var select = f("case");
      var selectId = "oh-case-" + entry.entry_id;
      select.id = selectId;
      f("case-label").htmlFor = selectId;
      var options = state.case_options.slice();
      if (entry.case && options.indexOf(entry.case) < 0) options.unshift(entry.case);
      options.forEach(function (name) {
        var o = document.createElement("option");
        o.value = name;
        o.textContent = name;
        if (name === entry.case) o.selected = true;
        select.appendChild(o);
      });
      var dot = row.querySelector(".oh-matter");
      dot.dataset.color = caseColor(entry.case);
      select.addEventListener("change", function () {
        entry.case = select.value;
        dot.dataset.color = caseColor(entry.case);
        emit("case-change", entry, select.value);
      });

      // Output buttons
      var memo = row.querySelector('[data-action="memo"]');
      if (!entry.voice_note) {
        memo.disabled = true;
        memo.title = "No voice note for this entry";
      }
      row.querySelectorAll("[data-action]").forEach(function (btn) {
        btn.addEventListener("click", function () { emit(btn.dataset.action, entry); });
      });

      body.appendChild(row);
    });
  }

  // ---------- page-level buttons ----------
  function bindPageActions() {
    document.querySelectorAll('.oh-header [data-action]').forEach(function (btn) {
      btn.addEventListener("click", function () { emit(btn.dataset.action); });
    });
    var rec = document.querySelector('[data-action="record"]');
    if (rec) {
      var start = function (e) {
        if (rec.getAttribute("aria-pressed") === "true") return;
        e.preventDefault();
        rec.setAttribute("aria-pressed", "true");
        emit("record-start");
      };
      var stop = function () {
        if (rec.getAttribute("aria-pressed") !== "true") return;
        rec.setAttribute("aria-pressed", "false");
        emit("record-stop");
      };
      rec.addEventListener("pointerdown", start);
      ["pointerup", "pointerleave", "pointercancel"].forEach(function (t) { rec.addEventListener(t, stop); });
      rec.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") start(e); });
      rec.addEventListener("keyup",   function (e) { if (e.key === " " || e.key === "Enter") stop(); });
    }
  }

  var bound = false;

  window.OfficeHubTimeTracker = {
    render: function (data) {
      data = data || {};
      state.time_entries = Array.isArray(data.time_entries) ? data.time_entries : [];
      state.case_options = Array.isArray(data.case_options) ? data.case_options : [];
      state.active = data.active || null;

      // Default to the most recent date that has entries (or today)
      if (!state.selectedDate || !state.time_entries.some(function (e) { return e.date === state.selectedDate; })) {
        var dates = state.time_entries.map(function (e) { return e.date; }).sort();
        state.selectedDate = dates.length ? dates[dates.length - 1] : toISO(new Date());
      }

      renderNav();
      renderWeek();
      renderRows();
      if (!bound) { bindPageActions(); bound = true; }
    }
  };
})();

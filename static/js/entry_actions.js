/* Connects the OfficeHub UI (time_tracker.js, calendar.js, entry_drawer.js) to the FastAPI backend.
   The UI scripts only draw the page and emit "officehub:action" events; this file decides what
   each action does, then reloads the data from the API so the page always shows what's in the DB.

   Each page calls it once:
     OfficeHubEntries.init({
       data: {...page data...},
       rerender: (data, focusDate) => { ...redraw the page with fresh data... }
     });
*/
(function () {
  "use strict";

  let page = { data: {}, rerender: () => {} };

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let detail = res.status + " " + res.statusText;
      try {
        const err = await res.json();
        // FastAPI 422s give a list of {loc, msg}; other errors give a string
        detail = Array.isArray(err.detail)
          ? err.detail.map((d) => d.loc.slice(-1)[0] + ": " + d.msg).join("\n")
          : err.detail || detail;
      } catch (_) { /* response had no JSON body */ }
      throw new Error(detail);
    }
    return res.status === 204 ? null : res.json();
  }

  // Reload entries + cases from the API and redraw the page, optionally jumping to a date.
  async function refresh(focusDate) {
    const [entries, cases] = await Promise.all([api("GET", "/api/entries"), api("GET", "/api/cases")]);
    page.data = { ...page.data, time_entries: entries, case_options: cases.map((c) => c.name) };
    page.rerender(page.data, focusDate);
  }

  // Run an API call; on failure tell the user and resync so the page never shows unsaved changes.
  async function attempt(what, fn, focusDate) {
    try {
      await fn();
      await refresh(focusDate);
    } catch (err) {
      console.error(err);
      alert("Couldn't " + what + ":\n" + err.message);
      refresh(focusDate).catch(console.error);
    }
  }

  function recentCases() {
    const seen = [];
    (page.data.time_entries || []).slice()
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
      .forEach((e) => { if (e.case && !seen.includes(e.case)) seen.push(e.case); });
    return seen;
  }

  const handlers = {
    // From the drawer: new entry (entry_id null) or edit (entry_id set)
    "entry-save": ({ entry }) => {
      const body = { date: entry.date, time: entry.time, purpose: entry.purpose, case: entry.case, notes: entry.notes };
      const isNew = entry.entry_id == null;
      if (isNew) body.user_name = entry.user_name || null;
      return attempt(isNew ? "save the entry" : "save your changes", () =>
        isNew ? api("POST", "/api/entries", body) : api("PATCH", "/api/entries/" + entry.entry_id, body),
      entry.date);
    },

    // From the drawer's Delete button (edit mode only)
    "entry-delete": ({ entry }) => {
      if (!confirm('Delete "' + entry.purpose + '"? This cannot be undone.')) return;
      return attempt("delete the entry", () => api("DELETE", "/api/entries/" + entry.entry_id), entry.date);
    },

    // Time Tracker: case dropdown on a row
    "case-change": ({ entry, value }) =>
      attempt("change the case", () => api("PATCH", "/api/entries/" + entry.entry_id, { case: value }), entry.date),

    // Time Tracker: Edit chip on a row
    "edit": ({ entry }) => {
      window.OfficeHubEntryDrawer.open({
        entry,
        case_options: page.data.case_options || [],
        recent_cases: recentCases(),
        defaults: { user_name: page.data.user_name },
      });
    },
  };

  document.addEventListener("officehub:action", (e) => {
    const handler = handlers[e.detail.action];
    if (handler) handler(e.detail);
    else console.info("[OfficeHub] not implemented yet:", e.detail.action, e.detail.entry);
  });

  window.OfficeHubEntries = {
    init(opts) { page = { data: opts.data || {}, rerender: opts.rerender }; },
    refresh,
  };
})();

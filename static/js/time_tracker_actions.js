/* Connects the Time Tracker UI (time_tracker.js) to the FastAPI backend.
   time_tracker.js only draws the page and emits "officehub:action" events;
   this file decides what each action does. */
(function () {
  "use strict";

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(method + " " + url + " failed: " + res.status);
    return res.status === 204 ? null : res.json();
  }

  const handlers = {
    // Case dropdown changed: save it. On failure, reload so the page shows what's really stored.
    "case-change": async ({ entry, value }) => {
      try {
        await api("PATCH", "/api/entries/" + entry.entry_id, { case: value });
      } catch (err) {
        console.error(err);
        alert("Couldn't save the case change. The page will reload.");
        location.reload();
      }
    },
  };

  document.addEventListener("officehub:action", (e) => {
    const handler = handlers[e.detail.action];
    if (handler) handler(e.detail);
    else console.info("[OfficeHub] not implemented yet:", e.detail.action, e.detail.entry);
  });
})();

/* Records or uploads a voice note for the entry drawer and stores it via POST /api/recordings.

   Listens for the drawer's events:
     "voice-note-record-start" / "voice-note-record-stop"  — microphone recording (MediaRecorder)
     "voice-note-upload" (value = File)                     — an audio file picked from disk
     "voice-note-record-cancel"                              — Cancel clicked mid-recording: throw it away
     "voice-note-discard" (value = recording_id)             — Cancel on an uploaded-but-unsaved note: delete it
   and reports back through OfficeHubEntryDrawer.setVoiceNote / setVoiceStatus / setRecording / setBusy.
   The recording is only linked to an entry when the drawer is saved (recording_id in the entry body);
   Cancel deletes it; hiding the drawer (X / Esc / outside click) keeps it in the draft.
   (The server also wipes recordings left unattached for over a day, at startup.) */
(function () {
  "use strict";

  const MAX_SECONDS = 10 * 60;          // auto-stop long recordings
  // Preferred formats, best first. Chrome/Edge/Firefox do webm/opus; Safari does mp4.
  const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  const EXT = { "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a" };

  let recorder = null, stream = null, chunks = [], startedAt = 0, timer = null, cancelled = false;
  const drawer = () => window.OfficeHubEntryDrawer;

  const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  const elapsed = () => (Date.now() - startedAt) / 1000;

  function fail(message) {
    drawer().setRecording(false);
    drawer().setBusy(false);
    drawer().setVoiceStatus(message, true);
  }

  async function start() {
    if (recorder) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      return fail("Recording isn't supported in this browser — use “upload audio” instead.");
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const reasons = {
        NotAllowedError: "Microphone access was blocked. Allow it in the browser's address bar and try again.",
        NotFoundError: "No microphone was found.",
        NotReadableError: "The microphone is being used by another app.",
      };
      return fail(reasons[err.name] || "Couldn't start the microphone: " + err.message);
    }

    const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    cancelled = false;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = finish;
    recorder.start(1000);               // hand over data every second, so nothing is lost on long notes

    startedAt = Date.now();
    drawer().setRecording(true);
    drawer().setBusy(true);
    tick();
    timer = setInterval(tick, 500);
  }

  function tick() {
    drawer().setVoiceStatus("Recording… " + fmt(elapsed()) + "  (click the mic to stop)");
    if (elapsed() >= MAX_SECONDS) stop();
  }

  function stop() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function cancel() {
    cancelled = true;   // finish() will throw the audio away instead of uploading it
    stop();
  }

  // Delete an uploaded recording that never got saved with an entry.
  function discard(recordingId) {
    if (recordingId == null) return;
    // keepalive: the request still completes if the page is being closed/navigated away
    fetch("/api/recordings/" + recordingId, { method: "DELETE", keepalive: true }).catch(console.error);
  }

  async function finish() {
    clearInterval(timer);
    const duration = elapsed();
    const type = (recorder.mimeType || "audio/webm").split(";")[0];
    stream.getTracks().forEach((t) => t.stop());   // turns the browser's "recording" indicator off
    recorder = null;
    stream = null;
    drawer().setRecording(false);

    const blob = new Blob(chunks, { type });
    chunks = [];
    drawer().setBusy(false);
    if (cancelled) { cancelled = false; return; }   // drawer was closed without saving
    if (!blob.size) return fail("Nothing was recorded — try again.");
    await upload(blob, "voice-note" + (EXT[type] || ".webm"), duration);
  }

  async function upload(file, name, duration) {
    if (file.type && !file.type.startsWith("audio/")) return fail("That file isn't audio.");
    drawer().setBusy(true);
    drawer().setVoiceStatus("Uploading voice note…");
    const form = new FormData();
    form.append("file", file, name || file.name);
    if (duration) form.append("duration_seconds", duration.toFixed(1));
    try {
      const res = await fetch("/api/recordings", { method: "POST", body: form });
      if (!res.ok) {
        let detail = res.status + " " + res.statusText;
        try { detail = (await res.json()).detail || detail; } catch (_) { /* no JSON body */ }
        throw new Error(detail);
      }
      // Goes to the drawer session that recorded it, even if that drawer is hidden as a draft now
      drawer().setVoiceNote(await res.json());
      drawer().setBusy(false);
    } catch (err) {
      console.error(err);
      fail("Upload failed: " + err.message);
    }
  }

  document.addEventListener("officehub:action", (e) => {
    const { action, value } = e.detail;
    if (action === "voice-note-record-start") start();
    else if (action === "voice-note-record-stop") stop();
    else if (action === "voice-note-record-cancel") cancel();
    else if (action === "voice-note-upload") upload(value, value.name);
    else if (action === "voice-note-discard") discard(value);
  });
})();

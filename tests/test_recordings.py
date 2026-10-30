from backend.routes import recordings
from backend.routes.recordings import UPLOAD_DIR

AUDIO = b"\x1aE\xdf\xa3fake-webm-bytes" * 100
ENTRY = {"date": "2026-10-30", "time": "10:00", "purpose": "Client call", "case": "Client work"}


def upload(client, data=AUDIO, content_type="audio/webm;codecs=opus", **form):
    return client.post("/api/recordings", files={"file": ("voice-note.webm", data, content_type)}, data=form)


def files_on_disk():
    return sorted(p.name for p in UPLOAD_DIR.iterdir()) if UPLOAD_DIR.exists() else []


def test_upload_stores_file_and_row(client):
    r = upload(client, duration_seconds="4.5")
    assert r.status_code == 201, r.text
    rec = r.json()
    assert rec["content_type"] == "audio/webm"           # codec suffix stripped
    assert rec["size_bytes"] == len(AUDIO)
    assert rec["duration_seconds"] == 4.5
    assert rec["entry_id"] is None
    assert rec["transcript_status"] == "none"
    assert rec["audio_url"] == f"/api/recordings/{rec['recording_id']}/audio"
    assert len(files_on_disk()) == 1 and files_on_disk()[0].endswith(".webm")


def test_audio_is_served_back(client):
    rec = upload(client).json()
    r = client.get(rec["audio_url"])
    assert r.status_code == 200
    assert r.content == AUDIO
    assert r.headers["content-type"].startswith("audio/webm")


def test_non_audio_is_415(client):
    assert upload(client, b"hello", "text/plain").status_code == 415
    assert files_on_disk() == []


def test_empty_upload_is_422(client):
    assert upload(client, b"").status_code == 422
    assert files_on_disk() == []


def test_oversize_is_413(client, monkeypatch):
    monkeypatch.setattr(recordings, "MAX_UPLOAD_BYTES", 100)
    assert upload(client, b"x" * 101).status_code == 413
    assert files_on_disk() == []  # partial file cleaned up


def test_create_entry_with_recording_sets_voice_note(client):
    rec = upload(client).json()
    entry = client.post("/api/entries", json={**ENTRY, "recording_id": rec["recording_id"]}).json()
    assert entry["voice_note"] == rec["audio_url"]
    assert client.get(f"/api/recordings/{rec['recording_id']}").json()["entry_id"] == entry["entry_id"]


def test_create_entry_with_missing_recording_is_404(client):
    assert client.post("/api/entries", json={**ENTRY, "recording_id": 999}).status_code == 404
    assert client.get("/api/entries").json() == []  # nothing half-saved


def test_voice_note_cannot_be_set_directly(client):
    entry = client.post("/api/entries", json={**ENTRY, "voice_note": "http://evil.example/x.mp3"}).json()
    assert entry["voice_note"] is None


def test_recording_cannot_belong_to_two_entries(client):
    rec = upload(client).json()
    client.post("/api/entries", json={**ENTRY, "recording_id": rec["recording_id"]})
    assert client.post("/api/entries", json={**ENTRY, "recording_id": rec["recording_id"]}).status_code == 409


def test_patch_replaces_and_removes_voice_note(client):
    first = upload(client).json()
    entry = client.post("/api/entries", json={**ENTRY, "recording_id": first["recording_id"]}).json()

    second = upload(client).json()
    r = client.patch(f"/api/entries/{entry['entry_id']}", json={"recording_id": second["recording_id"]})
    assert r.json()["voice_note"] == second["audio_url"]
    assert client.get(first["audio_url"]).status_code == 404   # replaced one is deleted
    assert len(files_on_disk()) == 1

    r = client.patch(f"/api/entries/{entry['entry_id']}", json={"recording_id": None})
    assert r.json()["voice_note"] is None
    assert files_on_disk() == []


def test_patch_without_recording_id_keeps_voice_note(client):
    rec = upload(client).json()
    entry = client.post("/api/entries", json={**ENTRY, "recording_id": rec["recording_id"]}).json()
    r = client.patch(f"/api/entries/{entry['entry_id']}", json={"notes": "edited"})
    assert r.json()["voice_note"] == rec["audio_url"]


def test_deleting_entry_deletes_its_recording(client):
    rec = upload(client).json()
    entry = client.post("/api/entries", json={**ENTRY, "recording_id": rec["recording_id"]}).json()
    assert client.delete(f"/api/entries/{entry['entry_id']}").status_code == 204
    assert client.get(f"/api/recordings/{rec['recording_id']}").status_code == 404
    assert files_on_disk() == []


def test_deleting_recording_clears_entry_voice_note(client):
    rec = upload(client).json()
    entry = client.post("/api/entries", json={**ENTRY, "recording_id": rec["recording_id"]}).json()
    assert client.delete(f"/api/recordings/{rec['recording_id']}").status_code == 204
    assert client.get(f"/api/entries/{entry['entry_id']}").json()["voice_note"] is None
    assert files_on_disk() == []


def test_purge_wipes_only_stale_unattached_recordings(client):
    import datetime as dt

    from backend.database import SessionLocal
    from backend.routes.recordings import Recording, purge_unattached_recordings

    stale = upload(client).json()                      # never saved with an entry
    fresh = upload(client).json()                      # still in someone's drawer draft
    kept = upload(client).json()
    client.post("/api/entries", json={**ENTRY, "recording_id": kept["recording_id"]})

    two_days_ago = dt.datetime.now(dt.UTC).replace(tzinfo=None) - dt.timedelta(days=2)
    with SessionLocal() as db:
        for rec_id in (stale["recording_id"], kept["recording_id"]):
            db.get(Recording, rec_id).created_at = two_days_ago
        db.commit()
        assert purge_unattached_recordings(db) == 1

    assert client.get(f"/api/recordings/{stale['recording_id']}").status_code == 404
    assert client.get(f"/api/recordings/{fresh['recording_id']}").status_code == 200
    assert client.get(f"/api/recordings/{kept['recording_id']}").status_code == 200   # attached → kept
    assert len(files_on_disk()) == 2

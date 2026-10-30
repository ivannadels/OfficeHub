import datetime as dt
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Session, relationship

from backend.database import PROJECT_ROOT, Base, get_db

# Audio files live on disk (not in the DB); the DB row points at the file. uploads/ is git-ignored.
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", PROJECT_ROOT / "uploads" / "recordings"))
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB ≈ 25+ minutes of compressed speech
CHUNK_BYTES = 1024 * 1024

# Browser-recorded and common uploaded formats → file extension on disk
EXTENSIONS = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/aac": ".aac",
    "audio/flac": ".flac",
}


# ---------- Database model ----------
class Recording(Base):
    __tablename__ = "recordings"

    recording_id = Column(Integer, primary_key=True)
    entry_id = Column(Integer, ForeignKey("tracker_entries.entry_id"), index=True)  # null until an entry is saved
    filename = Column(String, nullable=False, unique=True)  # server-generated, never the user's file name
    content_type = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False)
    duration_seconds = Column(Float)
    created_at = Column(DateTime, server_default=func.now())
    # Stage 2 (transcription) will fill these in
    transcript = Column(Text)
    transcript_status = Column(String, nullable=False, default="none")

    # String name avoids importing time_tracker here (it imports this module)
    entry = relationship("TimeEntry")

    @property
    def audio_url(self) -> str:
        return f"/api/recordings/{self.recording_id}/audio"

    @property
    def path(self) -> Path:
        return UPLOAD_DIR / self.filename


# ---------- Response schema ----------
class RecordingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    recording_id: int
    entry_id: int | None
    audio_url: str
    content_type: str
    size_bytes: int
    duration_seconds: float | None
    created_at: dt.datetime | None
    transcript: str | None
    transcript_status: str


# ---------- Helpers used by the entries routes ----------
def get_recording_or_404(recording_id: int, db: Session) -> Recording:
    recording = db.get(Recording, recording_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    return recording


def delete_recording(db: Session, recording: Recording) -> None:
    """Remove the row and its file (no commit — the caller commits)."""
    recording.path.unlink(missing_ok=True)
    db.delete(recording)


def attach_recording(db: Session, entry, recording_id: int | None) -> None:
    """Make `recording_id` the entry's only voice note (None = remove it). No commit."""
    for old in db.query(Recording).filter(Recording.entry_id == entry.entry_id):
        if old.recording_id != recording_id:
            delete_recording(db, old)  # replaced or removed: don't leave orphan files behind

    if recording_id is None:
        entry.voice_note = None
        return

    recording = get_recording_or_404(recording_id, db)
    if recording.entry_id not in (None, entry.entry_id):
        raise HTTPException(status_code=409, detail="Recording already belongs to another entry")
    recording.entry_id = entry.entry_id
    entry.voice_note = recording.audio_url


def delete_recordings_for_entry(db: Session, entry_id: int) -> None:
    for recording in db.query(Recording).filter(Recording.entry_id == entry_id):
        delete_recording(db, recording)


def purge_unattached_recordings(db: Session, older_than: dt.timedelta = dt.timedelta(days=1)) -> int:
    """Safety net: wipe recordings that never got saved with an entry (tab closed mid-entry, etc.).

    The browser already deletes these on Cancel; this catches what it couldn't. The grace period
    keeps recordings that belong to a drawer draft someone hasn't finished yet.
    """
    cutoff = dt.datetime.now(dt.UTC).replace(tzinfo=None) - older_than  # created_at is stored as naive UTC
    stale = db.query(Recording).filter(Recording.entry_id.is_(None), Recording.created_at < cutoff).all()
    for recording in stale:
        delete_recording(db, recording)
    db.commit()
    return len(stale)


# ---------- Routes ----------
router = APIRouter(prefix="/api/recordings", tags=["recordings"])


@router.post("", response_model=RecordingRead, status_code=201)
def upload_recording(
    file: UploadFile = File(...),
    duration_seconds: float | None = Form(None),
    db: Session = Depends(get_db),
):
    # Browsers send e.g. "audio/webm;codecs=opus" — keep only the base type
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if not content_type.startswith("audio/"):
        raise HTTPException(status_code=415, detail="Only audio files can be uploaded")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = uuid.uuid4().hex + EXTENSIONS.get(content_type, ".audio")
    path = UPLOAD_DIR / filename

    # Copy in chunks so a huge file never sits in memory; stop as soon as it's over the limit
    size = 0
    try:
        with path.open("wb") as out:
            while chunk := file.file.read(CHUNK_BYTES):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Recording is larger than 25 MB")
                out.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    if size == 0:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="The recording is empty")

    recording = Recording(filename=filename, content_type=content_type, size_bytes=size,
                          duration_seconds=duration_seconds)
    db.add(recording)
    db.commit()
    db.refresh(recording)
    return recording


@router.get("/{recording_id}", response_model=RecordingRead)
def get_recording(recording_id: int, db: Session = Depends(get_db)):
    return get_recording_or_404(recording_id, db)


@router.get("/{recording_id}/audio")
def get_recording_audio(recording_id: int, db: Session = Depends(get_db)):
    recording = get_recording_or_404(recording_id, db)
    if not recording.path.exists():
        raise HTTPException(status_code=404, detail="Audio file is missing")
    return FileResponse(recording.path, media_type=recording.content_type)


@router.delete("/{recording_id}", status_code=204)
def delete_recording_route(recording_id: int, db: Session = Depends(get_db)):
    recording = get_recording_or_404(recording_id, db)
    if recording.entry is not None:
        recording.entry.voice_note = None
    delete_recording(db, recording)
    db.commit()

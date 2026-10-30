import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, Date, DateTime, Integer, String, Time, func
from sqlalchemy.orm import Session

from backend.database import Base, get_db
from backend.routes.recordings import attach_recording, delete_recordings_for_entry


# ---------- Database model ----------
class TimeEntry(Base):
    __tablename__ = "tracker_entries"

    entry_id = Column(Integer, primary_key=True)
    user_name = Column(String, index=True)
    date = Column(Date, nullable=False, index=True)
    time = Column(Time, nullable=False)
    purpose = Column(String, nullable=False)
    case = Column(String, nullable=False, index=True)
    notes = Column(String, default="")
    voice_note = Column(String)  # audio URL of the attached recording; set by the server, not by clients
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ---------- Request / response schemas ----------
class EntryBase(BaseModel):
    date: dt.date
    time: dt.time
    purpose: str = Field(min_length=1, max_length=100)
    case: str = Field(min_length=1, max_length=50)
    notes: str = Field(default="", max_length=500)
    user_name: str | None = None  # until auth exists


class EntryCreate(EntryBase):
    recording_id: int | None = None  # an uploaded recording (POST /api/recordings) to attach


class EntryUpdate(BaseModel):
    """Every field optional: only the ones sent get changed."""
    date: dt.date | None = None
    time: dt.time | None = None
    purpose: str | None = Field(default=None, min_length=1, max_length=100)
    case: str | None = Field(default=None, min_length=1, max_length=50)
    notes: str | None = Field(default=None, max_length=500)
    recording_id: int | None = None  # send a new id to replace the voice note, null to remove it


class EntryRead(EntryBase):
    model_config = ConfigDict(from_attributes=True)  # lets Pydantic read SQLAlchemy objects

    entry_id: int
    voice_note: str | None
    created_at: dt.datetime | None
    updated_at: dt.datetime | None


# ---------- Routes ----------
router = APIRouter(prefix="/api/entries", tags=["entries"])


def get_entry_or_404(entry_id: int, db: Session) -> TimeEntry:
    entry = db.get(TimeEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


def query_entries(
    db: Session,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
    case: str | None = None,
) -> list[TimeEntry]:
    """Shared by the API and the HTML page so both always show the same entries, newest first."""
    query = db.query(TimeEntry)
    if date_from:
        query = query.filter(TimeEntry.date >= date_from)
    if date_to:
        query = query.filter(TimeEntry.date <= date_to)
    if case:
        query = query.filter(TimeEntry.case == case)
    return query.order_by(TimeEntry.date.desc(), TimeEntry.time.desc()).all()


@router.get("", response_model=list[EntryRead])
def list_entries(
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
    case: str | None = None,
    db: Session = Depends(get_db),
):
    return query_entries(db, date_from, date_to, case)


@router.post("", response_model=EntryRead, status_code=201)
def create_entry(data: EntryCreate, db: Session = Depends(get_db)):
    entry = TimeEntry(**data.model_dump(exclude={"recording_id"}))
    db.add(entry)
    if data.recording_id is not None:
        db.flush()  # gives the entry its id so the recording can point at it
        attach_recording(db, entry, data.recording_id)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/{entry_id}", response_model=EntryRead)
def get_entry(entry_id: int, db: Session = Depends(get_db)):
    return get_entry_or_404(entry_id, db)


@router.patch("/{entry_id}", response_model=EntryRead)
def update_entry(entry_id: int, data: EntryUpdate, db: Session = Depends(get_db)):
    entry = get_entry_or_404(entry_id, db)
    changes = data.model_dump(exclude_unset=True)
    if "recording_id" in changes:  # only touch the voice note when the client asked to
        attach_recording(db, entry, changes.pop("recording_id"))
    for key, value in changes.items():
        setattr(entry, key, value)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = get_entry_or_404(entry_id, db)
    delete_recordings_for_entry(db, entry_id)
    db.delete(entry)
    db.commit()

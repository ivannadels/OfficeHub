import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, Date, DateTime, Integer, String, Time, func
from sqlalchemy.orm import Session

from backend.database import Base, get_db


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
    voice_note = Column(String)  # URL/path to the audio file
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ---------- Request / response schemas ----------
class EntryCreate(BaseModel):
    date: dt.date
    time: dt.time
    purpose: str = Field(min_length=1, max_length=100)
    case: str = Field(min_length=1, max_length=50)
    notes: str = Field(default="", max_length=500)
    voice_note: str | None = None
    user_name: str | None = None  # until auth exists


class EntryUpdate(BaseModel):
    """Every field optional: only the ones sent get changed."""
    date: dt.date | None = None
    time: dt.time | None = None
    purpose: str | None = Field(default=None, min_length=1, max_length=100)
    case: str | None = Field(default=None, min_length=1, max_length=50)
    notes: str | None = Field(default=None, max_length=500)
    voice_note: str | None = None


class EntryRead(EntryCreate):
    model_config = ConfigDict(from_attributes=True)  # lets Pydantic read SQLAlchemy objects

    entry_id: int
    created_at: dt.datetime | None
    updated_at: dt.datetime | None


# ---------- Routes ----------
router = APIRouter(prefix="/api/entries", tags=["entries"])


def get_entry_or_404(entry_id: int, db: Session) -> TimeEntry:
    entry = db.get(TimeEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@router.get("", response_model=list[EntryRead])
def list_entries(db: Session = Depends(get_db)):
    return db.query(TimeEntry).order_by(TimeEntry.date, TimeEntry.time).all()


@router.post("", response_model=EntryRead, status_code=201)
def create_entry(data: EntryCreate, db: Session = Depends(get_db)):
    entry = TimeEntry(**data.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/{entry_id}", response_model=EntryRead)
def get_entry(entry_id: int, db: Session = Depends(get_db)):
    return get_entry_or_404(entry_id, db)


@router.patch("/{entry_id}", response_model=EntryRead)
def update_entry(entry_id: int, data: EntryUpdate, db: Session = Depends(get_db)):
    entry = get_entry_or_404(entry_id, db)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(entry, key, value)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = get_entry_or_404(entry_id, db)
    db.delete(entry)
    db.commit()

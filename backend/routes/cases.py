from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import Session

from backend.database import Base, get_db


# ---------- Database model ----------
class Case(Base):
    __tablename__ = "cases"

    case_id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)


# ---------- Request / response schemas ----------
class CaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class CaseRead(CaseCreate):
    model_config = ConfigDict(from_attributes=True)

    case_id: int


# ---------- Routes ----------
router = APIRouter(prefix="/api/cases", tags=["cases"])


def list_case_names(db: Session) -> list[str]:
    return [c.name for c in db.query(Case).order_by(Case.name).all()]


@router.get("", response_model=list[CaseRead])
def list_cases(db: Session = Depends(get_db)):
    return db.query(Case).order_by(Case.name).all()


@router.post("", response_model=CaseRead, status_code=201)
def create_case(data: CaseCreate, db: Session = Depends(get_db)):
    name = data.name.strip()
    if db.query(Case).filter(Case.name == name).first():
        raise HTTPException(status_code=409, detail="Case already exists")
    case = Case(name=name)
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@router.delete("/{case_id}", status_code=204)
def delete_case(case_id: int, db: Session = Depends(get_db)):
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    db.delete(case)
    db.commit()

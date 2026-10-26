import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Absolute path so the DB lands in the project root no matter where the server is started from
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{PROJECT_ROOT / 'test.db'}")

# check_same_thread=False: FastAPI may use a session on a different thread than the one that created it
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Yield one session per request and always close it, even if the route raises."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

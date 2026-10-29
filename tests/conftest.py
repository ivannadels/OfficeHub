import os

import pytest

# Point the app at a throwaway database BEFORE backend.database is imported
os.environ["DATABASE_URL"] = "sqlite:///./tests/test_run.db"

from fastapi.testclient import TestClient  # noqa: E402

from backend.database import Base, engine  # noqa: E402
from backend.main import app  # noqa: E402


@pytest.fixture
def client():
    """A fresh, empty database for every test."""
    Base.metadata.drop_all(bind=engine)
    with TestClient(app) as c:  # `with` runs the lifespan, which creates the tables
        yield c
    Base.metadata.drop_all(bind=engine)

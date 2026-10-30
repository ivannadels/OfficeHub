import os
import shutil

import pytest

# Point the app at a throwaway database and upload folder BEFORE backend is imported
os.environ["DATABASE_URL"] = "sqlite:///./tests/test_run.db"
os.environ["UPLOAD_DIR"] = "./tests/uploads"  # git-ignored ("uploads/" matches at any depth)

from fastapi.testclient import TestClient  # noqa: E402

from backend.database import Base, engine  # noqa: E402
from backend.main import app  # noqa: E402
from backend.routes.recordings import UPLOAD_DIR  # noqa: E402


@pytest.fixture
def client():
    """A fresh, empty database and upload folder for every test."""
    Base.metadata.drop_all(bind=engine)
    shutil.rmtree(UPLOAD_DIR, ignore_errors=True)
    with TestClient(app) as c:  # `with` runs the lifespan, which creates the tables and folder
        yield c
    Base.metadata.drop_all(bind=engine)
    shutil.rmtree(UPLOAD_DIR, ignore_errors=True)

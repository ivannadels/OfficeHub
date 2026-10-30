from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from backend.database import Base, SessionLocal, engine, get_db
from backend.routes import cases, recordings, time_tracker

# templates/ and static/ live at the project root, one level above backend/
BASE_DIR = Path(__file__).resolve().parent.parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs once at startup: create any missing tables (every model is imported above)
    Base.metadata.create_all(bind=engine)
    recordings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with SessionLocal() as db:  # recordings are only kept if their entry was saved
        recordings.purge_unattached_recordings(db)
    yield


app = FastAPI(title="OfficeHub", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


def static_url(path: str) -> str:
    """/static/<path>?v=<last-modified time>: browsers re-download a file as soon as it changes,
    instead of running a stale cached copy."""
    file = BASE_DIR / "static" / path
    version = int(file.stat().st_mtime) if file.exists() else 0
    return f"/static/{path}?v={version}"


templates.env.globals["static_url"] = static_url

app.include_router(time_tracker.router)
app.include_router(cases.router)
app.include_router(recordings.router)


# ---------- Pages ----------
# Until there is login, every entry made from the UI is logged under this name
CURRENT_USER_NAME = "Demo User"


def render_page(request: Request, db: Session, template: str, active: str):
    """Render a page whose JS renderer gets entries + cases as JSON (same shape as the API)."""
    page_data = {
        "active": active,
        "user_name": CURRENT_USER_NAME,
        "case_options": cases.list_case_names(db),
        "time_entries": [
            time_tracker.EntryRead.model_validate(e).model_dump(mode="json")
            for e in time_tracker.query_entries(db)
        ],
    }
    return templates.TemplateResponse(request, template, {"page_data": page_data, "active": active})


@app.get("/", include_in_schema=False)
def home():
    return RedirectResponse("/time-tracker")


@app.get("/time-tracker", response_class=HTMLResponse)
def time_tracker_page(request: Request, db: Session = Depends(get_db)):
    return render_page(request, db, "time_tracker.html", active="time_tracker")


@app.get("/calendar", response_class=HTMLResponse)
def calendar_page(request: Request, db: Session = Depends(get_db)):
    return render_page(request, db, "calendar.html", active="calendar")

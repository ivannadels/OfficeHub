from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from backend.database import Base, engine, get_db
from backend.routes import cases, time_tracker

# templates/ and static/ live at the project root, one level above backend/
BASE_DIR = Path(__file__).resolve().parent.parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs once at startup: create any missing tables (every model is imported above)
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="OfficeHub", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")

app.include_router(time_tracker.router)
app.include_router(cases.router)


# ---------- Pages ----------
@app.get("/", include_in_schema=False)
def home():
    return RedirectResponse("/time-tracker")


@app.get("/time-tracker", response_class=HTMLResponse)
def time_tracker_page(request: Request, db: Session = Depends(get_db)):
    # Same shape as GET /api/entries, handed to the page's JS renderer as JSON
    page_data = {
        "active": "time_tracker",
        "case_options": cases.list_case_names(db),
        "time_entries": [
            time_tracker.EntryRead.model_validate(e).model_dump(mode="json")
            for e in time_tracker.query_entries(db)
        ],
    }
    return templates.TemplateResponse(
        request,
        "time_tracker.html",
        {"page_data": page_data, "active": page_data["active"]},
    )

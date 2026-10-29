from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import HTMLResponse
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
@app.get("/", response_class=HTMLResponse)
def time_tracker_page(request: Request, db: Session = Depends(get_db)):
    return templates.TemplateResponse(
        request,
        "time_tracker.html",
        {
            "time_entries": time_tracker.query_entries(db),
            "case_options": cases.list_case_names(db),
            "active": "time",
        },
    )

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from database import Base, engine
from backend.routes import time_tracker

# templates/ and static/ live at the project root, one level above backend/
BASE_DIR = Path(__file__).resolve().parent.parent

# Create any missing tables (only after every model above has been imported)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="OfficeHub")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")
app.include_router(time_tracker.router)

# Fake data for the mockup
TIME_ENTRIES = [
    {"date": "4/1/2035", "purpose": "Client call", "case": "Client work", "time": "9:00 AM", "notes": "Discussed campaign goals"},
    {"date": "4/1/2035", "purpose": "Content writing", "case": "Client work", "time": "11:00 AM", "notes": "Drafted blog post"},
    {"date": "4/1/2035", "purpose": "Admin tasks", "case": "Internal", "time": "1:00 PM", "notes": "Email and reports"},
    {"date": "4/2/2035", "purpose": "Design review", "case": "Client work", "time": "9:30 AM", "notes": "Feedback on visuals"},
    {"date": "4/2/2035", "purpose": "Research", "case": "Client work", "time": "10:45 AM", "notes": "Competitor analysis"},
    {"date": "4/3/2035", "purpose": "Team meeting", "case": "Internal", "time": "2:00 PM", "notes": "Weekly sprint planning"},
    {"date": "4/3/2035", "purpose": "Invoicing", "case": "Billing", "time": "4:15 PM", "notes": "Sent March invoices"},
]

CASE_OPTIONS = ["Client work", "Internal", "Billing", "Pro bono"]


@app.get("/", response_class=HTMLResponse)
def time_tracker(request: Request):
    return templates.TemplateResponse(
        request,
        "time_tracker.html",
        {"entries": TIME_ENTRIES, "case_options": CASE_OPTIONS, "active": "time"},
    )


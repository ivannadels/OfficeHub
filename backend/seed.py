"""Fill the database with sample cases and time entries.

Run from the project root:  python -m backend.seed          (only seeds an empty database)
                            python -m backend.seed --reset  (wipes entries and cases first)
"""
import datetime as dt
import sys

from backend.database import Base, SessionLocal, engine
from backend.routes.cases import Case
from backend.routes.time_tracker import TimeEntry

CASES = ["Client work", "Internal", "Billing", "Pro bono"]

# (days ago, time, purpose, case, notes)
ENTRIES = [
    (0, dt.time(9, 0), "Client call", "Client work", "Discussed campaign goals"),
    (0, dt.time(11, 0), "Content writing", "Client work", "Drafted blog post"),
    (0, dt.time(13, 0), "Admin tasks", "Internal", "Email and reports"),
    (1, dt.time(9, 30), "Design review", "Client work", "Feedback on visuals"),
    (1, dt.time(10, 45), "Research", "Client work", "Competitor analysis"),
    (1, dt.time(15, 0), "Consultation", "Pro bono", "Intake call with community org"),
    (2, dt.time(14, 0), "Team meeting", "Internal", "Weekly sprint planning"),
    (2, dt.time(16, 15), "Invoicing", "Billing", "Sent monthly invoices"),
    (3, dt.time(10, 0), "Contract review", "Client work", "Redlined service agreement"),
    (4, dt.time(8, 30), "Expense reports", "Billing", "Reconciled card statements"),
]


def seed(reset: bool = False) -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if reset:
            db.query(TimeEntry).delete()
            db.query(Case).delete()
            db.commit()
        elif db.query(TimeEntry).first() or db.query(Case).first():
            print("Database already has data; use --reset to replace it.")
            return

        db.add_all(Case(name=name) for name in CASES)
        today = dt.date.today()
        db.add_all(
            TimeEntry(date=today - dt.timedelta(days=days_ago), time=time,
                      purpose=purpose, case=case, notes=notes, user_name="Demo User")
            for days_ago, time, purpose, case, notes in ENTRIES
        )
        db.commit()
        print(f"Seeded {len(CASES)} cases and {len(ENTRIES)} entries.")
    finally:
        db.close()


if __name__ == "__main__":
    seed(reset="--reset" in sys.argv)

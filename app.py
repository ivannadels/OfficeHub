from flask import Flask, render_template

app = Flask(__name__)

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


@app.route("/")
def time_tracker():
    return render_template(
        "time_tracker.html",
        entries=TIME_ENTRIES,
        case_options=CASE_OPTIONS,
        active="time",
    )


if __name__ == "__main__":
    app.run(debug=True)

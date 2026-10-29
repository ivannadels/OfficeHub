import json
import re


def test_create_and_list_cases(client):
    assert client.post("/api/cases", json={"name": "Internal"}).status_code == 201
    assert client.post("/api/cases", json={"name": "Billing"}).status_code == 201
    names = [c["name"] for c in client.get("/api/cases").json()]
    assert names == ["Billing", "Internal"]  # alphabetical


def test_duplicate_case_is_409(client):
    client.post("/api/cases", json={"name": "Billing"})
    assert client.post("/api/cases", json={"name": "Billing"}).status_code == 409


def test_delete_case(client):
    case = client.post("/api/cases", json={"name": "Pro bono"}).json()
    assert client.delete(f"/api/cases/{case['case_id']}").status_code == 204
    assert client.delete(f"/api/cases/{case['case_id']}").status_code == 404


def page_data(client):
    """Pull the JSON the page hands to OfficeHubTimeTracker.render(...)."""
    html = client.get("/time-tracker").text
    match = re.search(r"OfficeHubTimeTracker\.render\((.*)\);", html)
    assert match, "render() call not found in page"
    return json.loads(match.group(1))


def test_root_redirects_to_time_tracker(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "/time-tracker"


def test_page_empty_state(client):
    data = page_data(client)
    assert data["time_entries"] == []
    assert data["active"] == "time_tracker"


def test_page_marks_active_nav_link(client):
    html = client.get("/time-tracker").text
    assert 'data-page="time_tracker" aria-label="Time tracker" aria-current="page"' in html


def test_page_data_matches_db(client):
    client.post("/api/cases", json={"name": "Client work"})
    client.post("/api/cases", json={"name": "Billing"})
    client.post("/api/entries", json={"date": "2026-04-01", "time": "13:05", "purpose": "Design review",
                                      "case": "Client work", "notes": "Feedback on visuals"})
    data = page_data(client)
    assert data["case_options"] == ["Billing", "Client work"]
    [entry] = data["time_entries"]
    assert entry["purpose"] == "Design review"
    assert entry["date"] == "2026-04-01"      # ISO, as time_tracker.js expects
    assert entry["time"].startswith("13:05")  # 24h "HH:MM..."
    assert entry["entry_id"] > 0


def test_page_escapes_html_in_data(client):
    client.post("/api/entries", json={"date": "2026-04-01", "time": "09:00", "purpose": "x",
                                      "case": "c", "notes": "</script><script>alert(1)</script>"})
    html = client.get("/time-tracker").text
    assert "</script><script>alert(1)" not in html

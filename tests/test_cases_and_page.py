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


def test_page_empty_state(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "No entries yet" in r.text


def test_page_shows_db_entries_and_cases(client):
    client.post("/api/cases", json={"name": "Client work"})
    client.post("/api/cases", json={"name": "Billing"})
    client.post("/api/entries", json={"date": "2026-04-01", "time": "13:05", "purpose": "Design review",
                                      "case": "Client work", "notes": "Feedback on visuals"})
    html = client.get("/").text
    assert "Design review" in html
    assert "4/1/2026" in html          # US date, no leading zeros
    assert "1:05 PM" in html           # 12-hour time
    assert "<option selected>Client work</option>" in html
    assert "<option >Billing</option>" in html

SAMPLE = {
    "date": "2026-10-01",
    "time": "09:00",
    "purpose": "Client call",
    "case": "Client work",
    "notes": "Discussed campaign goals",
}


def create(client, **overrides):
    r = client.post("/api/entries", json={**SAMPLE, **overrides})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_and_get(client):
    entry = create(client)
    assert entry["entry_id"] > 0
    assert entry["created_at"] is not None

    r = client.get(f"/api/entries/{entry['entry_id']}")
    assert r.status_code == 200
    assert r.json()["purpose"] == "Client call"


def test_list_is_newest_first(client):
    create(client, date="2026-10-01")
    create(client, date="2026-10-03")
    create(client, date="2026-10-02")
    dates = [e["date"] for e in client.get("/api/entries").json()]
    assert dates == ["2026-10-03", "2026-10-02", "2026-10-01"]


def test_list_filters(client):
    create(client, date="2026-10-01", case="Billing")
    create(client, date="2026-10-05", case="Internal")
    create(client, date="2026-10-09", case="Billing")

    billing = client.get("/api/entries", params={"case": "Billing"}).json()
    assert len(billing) == 2

    window = client.get("/api/entries", params={"date_from": "2026-10-02", "date_to": "2026-10-08"}).json()
    assert [e["date"] for e in window] == ["2026-10-05"]


def test_patch_only_changes_sent_fields(client):
    entry = create(client)
    r = client.patch(f"/api/entries/{entry['entry_id']}", json={"case": "Billing"})
    assert r.status_code == 200
    assert r.json()["case"] == "Billing"
    assert r.json()["purpose"] == "Client call"


def test_delete(client):
    entry = create(client)
    assert client.delete(f"/api/entries/{entry['entry_id']}").status_code == 204
    assert client.get(f"/api/entries/{entry['entry_id']}").status_code == 404


def test_missing_entry_is_404(client):
    assert client.get("/api/entries/999").status_code == 404
    assert client.patch("/api/entries/999", json={"notes": "x"}).status_code == 404
    assert client.delete("/api/entries/999").status_code == 404


def test_invalid_input_is_422(client):
    assert client.post("/api/entries", json={**SAMPLE, "date": "banana"}).status_code == 422
    assert client.post("/api/entries", json={**SAMPLE, "purpose": ""}).status_code == 422
    assert client.post("/api/entries", json={"purpose": "missing fields"}).status_code == 422

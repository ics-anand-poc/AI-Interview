"""Covers routers/interview.py. Since these tests run with an unreachable
Supabase URL (see conftest.FAKE_ENV) and no faceproj running, they exercise
exactly the failure paths that used to return an unhandled, non-JSON 500 —
see the _db_unavailable() fix in routers/interview.py. Every one of these
must come back as clean, parseable JSON."""


def test_access_missing_email_returns_400(client):
    res = client.post("/api/interview/access", json={})
    assert res.status_code == 422  # pydantic validation, not our own check


def test_access_blank_email_returns_400(client):
    res = client.post("/api/interview/access", json={"email": ""})
    assert res.status_code == 400
    assert res.json()["success"] is False


def test_access_db_unavailable_returns_clean_503_not_bare_500(client):
    res = client.post("/api/interview/access", json={"email": "candidate@example.com"})
    assert res.status_code == 503
    body = res.json()  # must be parseable JSON — this is the whole point of the fix
    assert body["success"] is False
    assert "error" in body


def test_verify_id_db_unavailable_returns_clean_503(client):
    res = client.post(
        "/api/interview/abc123/verify_id",
        json={"idImage": "data:image/png;base64,AAAA", "selfieImage": "data:image/png;base64,AAAA"},
    )
    assert res.status_code == 503
    assert "error" in res.json()


def test_proctor_violation_db_unavailable_returns_clean_503(client):
    res = client.post(
        "/api/interview/abc123/proctor_violation",
        json={"violationType": "looking_away", "warningCount": 1},
    )
    assert res.status_code == 503
    assert "error" in res.json()


def test_conclude_db_unavailable_returns_clean_503(client):
    res = client.post("/api/interview/abc123/conclude")
    assert res.status_code == 503
    assert "error" in res.json()


def test_monitor_faceproj_unreachable_returns_clean_500_json(client):
    # faceproj isn't running in this test tier — this must stay a clean JSON
    # error (already correct before this test suite existed; guards against
    # a regression).
    res = client.post("/api/interview/abc123/monitor", json={"frame": "data:image/png;base64,AAAA"})
    assert res.status_code == 500
    assert "error" in res.json()


def test_unknown_route_returns_404(client):
    res = client.get("/api/does-not-exist")
    assert res.status_code == 404

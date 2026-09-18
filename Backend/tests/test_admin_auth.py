"""Covers routers/admin_auth.py. All of this runs against the real app with
fake credentials — no live Supabase needed, since login/validate don't
require a DB read (only audit logging, which is already fire-and-forget)."""


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_login_wrong_domain_rejected(client):
    res = client.post("/api/admin/auth/login", json={"email": "foo@gmail.com", "password": "x"})
    assert res.status_code == 400


def test_login_wrong_password_rejected(client):
    res = client.post("/api/admin/auth/login", json={"email": "a@infinite.com", "password": "wrong"})
    assert res.status_code == 401


def test_login_success_returns_token(client):
    res = client.post("/api/admin/auth/login", json={"email": "a@infinite.com", "password": "test-admin-password"})
    assert res.status_code == 200
    assert "token" in res.json()


def test_validate_without_token_rejected(client):
    res = client.get("/api/admin/auth/validate")
    assert res.status_code == 401


def test_validate_with_valid_token_succeeds(client):
    login = client.post("/api/admin/auth/login", json={"email": "a@infinite.com", "password": "test-admin-password"})
    token = login.json()["token"]
    res = client.get("/api/admin/auth/validate", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200


def test_login_rate_limited_after_five_attempts(client):
    for _ in range(5):
        client.post("/api/admin/auth/login", json={"email": "a@infinite.com", "password": "wrong"})
    res = client.post("/api/admin/auth/login", json={"email": "a@infinite.com", "password": "wrong"})
    assert res.status_code == 429

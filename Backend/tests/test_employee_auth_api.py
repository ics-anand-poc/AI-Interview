"""Router-level tests for routers/employee_auth.py. The DB-dependent paths
(actual login with a real account) are mocked at the employee_account_service
level rather than requiring live Supabase — see test_employee_account_service.py
for the DB-free password-hashing unit tests, and this file's `mock_accounts`
fixture for how the router logic itself is exercised."""
import pytest


def test_login_missing_employee_id_field(client):
    # employee_id is a required Pydantic field, so a fully-omitted field is a
    # 422 validation error (same convention as test_interview_api.py's
    # test_access_missing_email_returns_400 vs test_access_blank_email_returns_400).
    res = client.post("/api/employee/auth/login", json={"password": "x"})
    assert res.status_code == 422


def test_login_blank_employee_id_returns_400(client):
    res = client.post("/api/employee/auth/login", json={"employee_id": "  ", "password": "x"})
    assert res.status_code == 400


def test_login_db_unavailable_returns_clean_503(client):
    res = client.post("/api/employee/auth/login", json={"employee_id": "E123", "password": "x"})
    assert res.status_code == 503
    assert "error" in res.json()


def test_validate_without_token_rejected(client):
    res = client.get("/api/employee/auth/validate")
    assert res.status_code == 401


def test_confirm_password_without_token_rejected(client):
    res = client.post("/api/employee/auth/confirm-password", json={"action": "keep"})
    assert res.status_code == 401


def test_set_password_missing_fields(client):
    res = client.post("/api/employee/auth/set-password", json={"employee_id": "E123"})
    assert res.status_code == 400


def test_set_password_weak_password_rejected(client):
    res = client.post("/api/employee/auth/set-password", json={
        "employee_id": "E123", "full_name": "Test User", "email": "e123@example.com", "password": "weak",
    })
    assert res.status_code == 400


@pytest.fixture()
def mock_accounts(monkeypatch):
    """In-memory stand-in for the `employees` Supabase table, so login's full
    logic (first-time detection, password verify, token issuance) can be
    tested without live Supabase."""
    from services import employee_account_service as accounts

    store = {}

    def fake_get(employee_id):
        return store.get(accounts._normalize_id(employee_id))

    def fake_add(account):
        key = accounts._normalize_id(account["employee_id"])
        if key in store:
            return False
        store[key] = {**account, "employee_id": account["employee_id"]}
        return True

    def fake_save_password(employee_id, password, full_name=None, email=None):
        employee = fake_get(employee_id)
        if not employee:
            return None
        h, s = accounts.hash_password(password)
        employee["password_hash"] = h
        employee["password_salt"] = s
        employee["is_first_login"] = False
        store[accounts._normalize_id(employee_id)] = employee
        return employee

    monkeypatch.setattr(accounts, "get_employee_account", fake_get)
    monkeypatch.setattr(accounts, "add_employee_account", fake_add)
    monkeypatch.setattr(accounts, "save_employee_password", fake_save_password)
    monkeypatch.setattr(accounts, "complete_first_time_login", lambda eid: fake_get(eid))
    return store


def test_first_login_creates_account_and_returns_first_time_status(client, mock_accounts):
    res = client.post("/api/employee/auth/login", json={"employee_id": "E999", "password": ""})
    assert res.status_code == 200
    assert res.json()["status"] == "first_time"
    assert "E999" in mock_accounts


def test_set_password_then_login_full_roundtrip(client, mock_accounts):
    set_res = client.post("/api/employee/auth/set-password", json={
        "employee_id": "E999", "full_name": "Test User", "email": "e999@example.com",
        "password": "Str0ng!Pass",
    })
    assert set_res.status_code == 200
    token = set_res.json()["token"]
    assert token

    login_res = client.post("/api/employee/auth/login", json={"employee_id": "E999", "password": "Str0ng!Pass"})
    assert login_res.status_code == 200
    assert login_res.json()["status"] == "ok"
    assert "token" in login_res.json()


def test_login_wrong_password_after_set_rejected(client, mock_accounts):
    client.post("/api/employee/auth/set-password", json={
        "employee_id": "E998", "full_name": "Test User", "email": "e998@example.com",
        "password": "Str0ng!Pass",
    })
    res = client.post("/api/employee/auth/login", json={"employee_id": "E998", "password": "WrongPass1!"})
    assert res.status_code == 401


def test_validate_with_real_token_after_setup(client, mock_accounts):
    set_res = client.post("/api/employee/auth/set-password", json={
        "employee_id": "E997", "full_name": "Test User", "email": "e997@example.com",
        "password": "Str0ng!Pass",
    })
    token = set_res.json()["token"]
    res = client.get("/api/employee/auth/validate", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["employee"]["employee_id"] == "E997"

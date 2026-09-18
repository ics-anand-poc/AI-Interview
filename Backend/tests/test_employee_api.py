"""Covers routers/employee.py."""


def test_monitor_without_auth_rejected(client):
    res = client.post("/api/employee/tests/t1/monitor", json={"frame": "data:image/png;base64,AAAA"})
    assert res.status_code == 401

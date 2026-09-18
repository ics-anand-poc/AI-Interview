"""
Shared pytest fixtures for the Backend test suite.

Two tiers, matching how these tests were actually run during development:

1. Unit/contract tests (this file's `client` fixture) — boot the real FastAPI
   app with fake, non-secret env values and no live Supabase/faceproj. These
   verify routing, validation, auth gating, and — importantly — that a
   downstream failure (DB unreachable, faceproj unreachable) produces a
   clean JSON error response instead of an unhandled 500. Safe to run
   anywhere, no network or real credentials needed.

2. Live integration tests (marked `@pytest.mark.live`) — require a real
   .env.local with working Supabase/faceproj credentials and are skipped by
   default. Run with `pytest -m live` once you have real credentials; see
   README.md in this directory.
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

FAKE_ENV = {
    "NEXT_PUBLIC_SUPABASE_URL": "http://localhost:9999",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "test-anon-key",
    "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
    "FACEPROJ_SERVICE_URL": "http://127.0.0.1:8000",
    "FACE_MATCH_KEY": "test-face-match-key",
    "EMPLOYEE_AUTH_SECRET": "test-employee-secret",
    "ADMIN_PASSWORD": "test-admin-password",
    "FRONTEND_ORIGIN": "http://localhost:3000",
}


@pytest.fixture()
def client(monkeypatch):
    for k, v in FAKE_ENV.items():
        monkeypatch.setenv(k, v)
    # Reload so module-level state (e.g. supabase_client's cached _client) doesn't
    # leak between tests with different fake credentials.
    for mod in list(sys.modules):
        if mod == "main" or mod.startswith("routers.") or mod.startswith("services."):
            del sys.modules[mod]
    import main as main_module
    return TestClient(main_module.app)

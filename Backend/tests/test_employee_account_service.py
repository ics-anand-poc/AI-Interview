"""Unit tests for services/employee_account_service.py — no Supabase needed,
these test pure functions (password hashing, validation).

test_pbkdf2_matches_node_reference below hard-codes a hash computed by the
*original* Node.js implementation (Frontend/src/lib/employee-auth.ts,
crypto.pbkdf2Sync) for a fixed password+salt. If this test starts failing,
it means a change made this Python port incompatible with password hashes
already stored in the real `employees` table by the still-live Next.js
auth flow — that's a "nobody can log in" severity bug, which is why this
is pinned as an exact-match test rather than just a round-trip check.
"""
from services.employee_account_service import (
    hash_password,
    verify_password,
    is_product_qb_employee,
    is_assessment_only_employee,
)


def test_hash_then_verify_roundtrip():
    hash_b64, salt_b64 = hash_password("correct horse battery staple 1!")
    assert verify_password("correct horse battery staple 1!", salt_b64, hash_b64)


def test_verify_rejects_wrong_password():
    hash_b64, salt_b64 = hash_password("correct horse battery staple 1!")
    assert not verify_password("wrong password", salt_b64, hash_b64)


def test_verify_rejects_missing_hash_or_salt():
    assert not verify_password("anything", "", "")
    assert not verify_password("anything", "salt-only", "")


def test_pbkdf2_matches_node_reference():
    # Computed with: crypto.pbkdf2Sync('Tr0ub4dor&Z', 'dGVzdC1zYWx0LTE2Ynl0ZXM=', 120000, 64, 'sha512')
    # — see the commit/PR notes for the exact node -e command used to generate this.
    salt = "dGVzdC1zYWx0LTE2Ynl0ZXM="
    expected_hash = "qjfszUdAh4c3i2AELXFMaxiwWPLU9jkoUa/6m7g7px7uYaEtpfvSkL1fLtAToelHHm9v1ulqKgNS9E61DqNZKw=="
    assert verify_password("Tr0ub4dor&Z", salt, expected_hash)


def test_is_product_qb_employee_excludes_admin():
    assert is_product_qb_employee({"role": "employee", "product_qb_eligible": True}) is True
    assert is_product_qb_employee({"role": "admin", "product_qb_eligible": True}) is False
    assert is_product_qb_employee({"role": "employee", "product_qb_eligible": False}) is False


def test_is_assessment_only_employee_excludes_admin():
    assert is_assessment_only_employee({"role": "employee", "assessment_only": True}) is True
    assert is_assessment_only_employee({"role": "admin", "assessment_only": True}) is False

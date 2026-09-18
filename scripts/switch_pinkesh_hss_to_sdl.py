"""
Switch Pinkesh Kumar (1041229) from HLR-HSS Q-form to SDL.
Keeps Emp ID, password, and existing test id. Does not touch other portal users.
"""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from add_paco_cmg3_portal_users import replace_or_create_test  # noqa: E402
from add_paco_phase2_portal_users import (  # noqa: E402
    ACCOUNTS_FILE,
    PROFILES_FILE,
    QUESTIONS_PER_EMPLOYEE,
    SUBJECT_ID,
    SUBJECT_TITLE,
    TIME_LIMIT_SECONDS,
    append_local_tests,
    assign_display_questions,
    build_bank_index,
    clean,
    load_json,
    normalize_question_key,
    parse_qb_new_xlsx,
    save_json,
    update_mapping_row,
)
import add_paco_phase2_portal_users as phase2  # noqa: E402
from reassign_test_questions_supabase import TOPIC_ID, SupabaseClient, load_env  # noqa: E402

EMP_ID = "1041229"
PRODUCT = "SDL"
TEST_ID = "6aed223f-e2fd-486b-8fc0-09bc7d1c2ee7"

DOCS = next(
    (
        p
        for p in (ROOT / "docs" / "NON-Needed docs", ROOT / "NON-Needed docs")
        if (p / "QB-new.xlsx").exists()
    ),
    ROOT / "docs" / "NON-Needed docs",
)
phase2.QB_FILE = DOCS / "QB-new.xlsx"
phase2.MAPPING_FILE = DOCS / "Resource_Question_Mapping.xlsx"
phase2.DOCS = DOCS
phase2.REMARKS = "Switched HSS -> SDL 17 Sep 2026"


def main() -> int:
    qb = DOCS / "QB-new.xlsx"
    if not qb.exists():
        print(f"ERROR: missing {qb}")
        return 1

    accounts = load_json(ACCOUNTS_FILE, {"employees": []})
    acc = next(
        (row for row in accounts.get("employees", []) if clean(row.get("employee_id")) == EMP_ID),
        None,
    )
    if not acc:
        print(f"ERROR: {EMP_ID} not in employee-accounts.json")
        return 1

    profiles = load_json(PROFILES_FILE, [])
    profile = next((row for row in profiles if clean(row.get("employee_id")) == EMP_ID), None)

    pools, mcq_records = parse_qb_new_xlsx(qb)
    bank = build_bank_index(mcq_records)
    assigned, remark = assign_display_questions(PRODUCT, pools.get(PRODUCT, []), employee_id=EMP_ID)
    assigned = [q for q in assigned if q]
    if len(assigned) < QUESTIONS_PER_EMPLOYEE:
        print(f"ERROR: only {len(assigned)} SDL questions. {remark}")
        return 1

    matched = []
    for q_text in assigned:
        item = bank.get(normalize_question_key(q_text)) or bank.get(
            normalize_question_key(q_text.split("] ", 1)[-1])
        )
        if not item:
            print(f"ERROR: unmatched question: {q_text[:120]}")
            return 1
        matched.append({**item, "question_text": q_text})

    acc["product"] = PRODUCT
    acc["product_qb_eligible"] = True
    acc["assessment_only"] = True
    save_json(ACCOUNTS_FILE, accounts)

    if profile:
        profile["product"] = PRODUCT
        profile["remarks"] = phase2.REMARKS
        profile["assigned_questions"] = assigned
        profile["assigned_question_count"] = len(assigned)
        save_json(PROFILES_FILE, profiles)

    now = datetime.now(timezone.utc).isoformat()
    test_row = {
        "id": TEST_ID,
        "employee_id": EMP_ID,
        "employee_code": EMP_ID,
        "topic_id": TOPIC_ID,
        "subject_id": SUBJECT_ID,
        "difficulty": "medium",
        "total_questions": len(matched),
        "time_limit_seconds": TIME_LIMIT_SECONDS,
        "status": "pending",
        "current_question_index": 0,
        "started_at": None,
        "completed_at": None,
        "in_progress": None,
        "created_at": now,
        "topic_title": PRODUCT,
        "subject_title": SUBJECT_TITLE,
    }
    questions = []
    for idx, q in enumerate(matched):
        questions.append(
            {
                "id": str(uuid.uuid4()),
                "test_id": TEST_ID,
                "question_index": idx,
                "question_text": q["question_text"],
                "options": q["options"],
                "correct_option_index": q["correct_option_index"],
                "explanation": q.get("explanation") or "Imported from QB-new.xlsx.",
                "difficulty": "medium",
                "topic_id": TOPIC_ID,
                "topic_title": q.get("category") or PRODUCT,
                "created_at": now,
            }
        )
    manifest = {
        "employee_id": EMP_ID,
        "full_name": acc.get("full_name") or "Pinkesh Kumar",
        "product": PRODUCT,
        "test_id": TEST_ID,
        "question_count": len(matched),
        "missing_questions": [],
    }
    append_local_tests([test_row], questions, [manifest])
    update_mapping_row(
        {
            "employee_id": EMP_ID,
            "full_name": acc.get("full_name") or "Pinkesh Kumar",
            "role": acc.get("role") or "Deployment",
            "domain": acc.get("department") or "SDM",
            "product": PRODUCT,
            "email": acc.get("email") or "",
            "ddh": "",
        },
        assigned,
    )

    url, key = load_env()
    client = SupabaseClient(url, key)
    emp_rows = client.get("employees", {"employee_id": f"eq.{EMP_ID}", "select": "id,product", "limit": "1"})
    if not emp_rows:
        print(f"ERROR: {EMP_ID} not in Supabase employees")
        return 1
    employee_uuid = emp_rows[0]["id"]
    client.patch("employees", {"employee_id": f"eq.{EMP_ID}"}, {"product": PRODUCT})
    replace_or_create_test(
        client,
        employee_uuid,
        {"employee_id": EMP_ID, "product": PRODUCT},
        matched,
        TEST_ID,
    )

    print(
        f"Switched {EMP_ID} Pinkesh Kumar {emp_rows[0].get('product')} -> {PRODUCT} "
        f"({len(matched)} questions). Same login Emp ID {EMP_ID}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

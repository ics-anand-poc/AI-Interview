#!/usr/bin/env python3
"""Local Laya sidecar — typed decisions (choice / score / noul), not a chat LLM.

English checkpoint only. Do not use Router(preload=True) here; that loads 3 models.
Default: http://127.0.0.1:8090
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.environ.get("LAYA_HOST", "127.0.0.1")
PORT = int(os.environ.get("LAYA_PORT", "8090"))
REPO = os.environ.get("LAYA_REPO", "convaiinnovations/laya")
DEVICE = os.environ.get("LAYA_DEVICE", "cpu")

HERE = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(HERE / ".cache" / "huggingface"))
os.environ.setdefault("TRANSFORMERS_CACHE", str(HERE / ".cache" / "huggingface"))

FIT_LEVELS = [
    "wrong family or no relevant skills",
    "same broad area but almost no required skills",
    "some required skills, many gaps",
    "most required skills, usable match",
    "strong match on mandatory skills and role",
]

PERSON_SCORE_QUESTIONS = {
    "fit": {
        "type": "score",
        "instructions": (
            "How well do this person's skills, designation, and experience match the job? "
            "Wrong technology family must be the bottom level. "
            "Same family with missing mandatory skills is mid. "
            "Strong overlap of mandatory skills is the top level."
        ),
        "criteria": FIT_LEVELS,
    },
    "wrong_family": {
        "type": "noul",
        "instructions": (
            "Is this person in a different skill family than the job "
            "(for example DevOps vs Java, or project manager vs software engineer)?"
        ),
    },
    "decision": {
        "type": "choice",
        "instructions": (
            "Hiring action for this person vs this job. "
            "Interview only if most mandatory skills are present and the family matches."
        ),
        "criteria": {
            "interview": "same family and most mandatory skills present",
            "screen": "same family and some mandatory skills",
            "hold": "weak or unclear overlap",
            "reject": "wrong family or almost none of the required skills",
        },
    },
}


def _num(val, default=0.0):
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


VECTOR_QUESTIONS = {
    "fit": PERSON_SCORE_QUESTIONS["fit"],
    "wrong_family": PERSON_SCORE_QUESTIONS["wrong_family"],
    "decision": PERSON_SCORE_QUESTIONS["decision"],
}


def person_questions(mandatory: list) -> dict:
    questions = {
        "wrong_family": PERSON_SCORE_QUESTIONS["wrong_family"],
        "decision": PERSON_SCORE_QUESTIONS["decision"],
        "fit": PERSON_SCORE_QUESTIONS["fit"],
    }
    for i, skill in enumerate(list(mandatory or [])[:8]):
        label = str(skill or "").strip()[:40]
        if not label:
            continue
        questions[f"sk_{i}"] = {
            "type": "noul",
            "instructions": f"Does this person's profile show real experience with {label}?",
        }
    return questions


def coverage_from_answers(answers: dict, mandatory: list) -> tuple[float, list[str], list[str]]:
    hits: list[str] = []
    misses: list[str] = []
    vals: list[float] = []
    for i, skill in enumerate(list(mandatory or [])[:8]):
        label = str(skill or "").strip()
        raw = (answers.get(f"sk_{i}") or {}).get("noul")
        p = _num(raw, 0.0)
        vals.append(p)
        if p >= 0.55:
            hits.append(label)
        else:
            misses.append(label)
    if not vals:
        return 0.0, hits, misses
    return sum(vals) / len(vals), hits, misses

FILE_KIND_QUESTIONS = {
    "kind": {
        "type": "choice",
        "instructions": (
            "Classify this HR screening file from the filename and text. "
            "Corp Pool is a people roster. Portal mapping is a test/question sheet, not a roster."
        ),
        "criteria": {
            "corp_pool": (
                "Bench/employee roster to match against jobs: Emp No, names, grades, skills. "
                "Not a test or question-mapping sheet."
            ),
            "jd": (
                "Job description: role title, responsibilities, mandatory skills. "
                "Often prose or a one-column JD, not Emp No rows."
            ),
            "br": (
                "Business requisition / BR workbook: requisition number, openings, hiring request."
            ),
            "portal_mapping": (
                "Employee Portal test or resource-to-question mapping. Not Corp Pool."
            ),
            "unknown": "Cannot tell, or none of the other kinds.",
        },
    }
}

_agent = None


def load_agent():
    global _agent
    if _agent is not None:
        return _agent
    print(f"Loading Laya {REPO} on {DEVICE} (first run downloads weights)…", flush=True)
    import laya

    kwargs = {"device": DEVICE} if DEVICE else {}
    try:
        _agent = laya.load(REPO, **kwargs)
    except TypeError:
        _agent = laya.load(REPO)
    print("Laya ready.", flush=True)
    return _agent


def answers_from_result(result) -> dict:
    if isinstance(result, dict):
        return result.get("answers") or result
    answers = getattr(result, "answers", None)
    if answers is not None:
        return answers
    return {}


def predict(state, questions) -> dict:
    agent = load_agent()
    result = agent.predict(state, questions)
    answers = answers_from_result(result)
    out = {}
    for key, raw in (answers or {}).items():
        if hasattr(raw, "__dict__") and not isinstance(raw, dict):
            raw = getattr(raw, "__dict__", raw)
        if not isinstance(raw, dict):
            raw = {"value": raw}
        item = {
            "choice": raw.get("choice"),
            "score": raw.get("score"),
            "noul": raw.get("noul"),
            "confidence": raw.get("confidence"),
            "probs": raw.get("probs") or raw.get("probabilities"),
        }
        out[key] = item
    return {"answers": out}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?", 1)[0] in ("/health", "/"):
            self._json(
                200,
                {
                    "ok": True,
                    "up": _agent is not None,
                    "model": REPO,
                    "device": DEVICE,
                },
            )
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        length = int(self.headers.get("Content-Length") or 0)
        try:
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._json(400, {"error": "invalid JSON"})
            return
        try:
            if path == "/v1/classify-file":
                file_name = str(data.get("fileName") or "")[:240]
                preview = str(data.get("preview") or "")[:1400]
                state = {"fileName": file_name, "preview": preview}
                result = predict(state, FILE_KIND_QUESTIONS)
                kind_ans = result["answers"].get("kind") or {}
                kind = kind_ans.get("choice") or "unknown"
                conf = kind_ans.get("confidence")
                probs = kind_ans.get("probs") or {}
                prob = None
                if isinstance(probs, dict) and kind in probs:
                    try:
                        prob = float(probs[kind])
                    except (TypeError, ValueError):
                        prob = None
                self._json(
                    200,
                    {
                        "kind": kind,
                        "confidence": conf,
                        "prob": prob,
                        "why": f"Laya classified as {kind}"
                        + (f" ({float(prob):.0%} match)" if prob is not None else "")
                        + (f", confidence {float(conf):.2f}" if conf is not None else ""),
                        "answers": result["answers"],
                    },
                )
                return
            if path == "/v1/score-vectors":
                jd_title = str(data.get("jdTitle") or data.get("jdFileName") or "JD")[:80]
                person_title = str(data.get("designation") or "")[:80]
                jd_vec = [str(s).strip() for s in (data.get("jdVec") or []) if str(s).strip()][:16]
                cv_vec = [str(s).strip() for s in (data.get("cvVec") or []) if str(s).strip()][:20]
                overlap = [str(s).strip() for s in (data.get("overlap") or []) if str(s).strip()][:16]
                missing = [str(s).strip() for s in (data.get("missing") or []) if str(s).strip()][:16]
                headline = [str(s).strip() for s in (data.get("headline") or []) if str(s).strip()][:4]
                state = {
                    "job": {"title": jd_title, "mustHave": jd_vec},
                    "person": {"title": person_title, "skills": cv_vec, "headline": headline},
                    "overlap": overlap,
                    "missingFromCv": missing,
                }
                result = predict(state, VECTOR_QUESTIONS)
                answers = result["answers"]
                fit = answers.get("fit") or {}
                raw_fit_f = _num(fit.get("score"), 0.0)
                max_level = max(1, len(FIT_LEVELS) - 1)
                fit_100 = int(round(max(0.0, min(1.0, raw_fit_f / max_level)) * 100))
                cover = int(round(100.0 * len(overlap) / max(1, len(jd_vec)))) if jd_vec else fit_100
                score_100 = int(round(0.55 * cover + 0.45 * fit_100))
                wrong = _num((answers.get("wrong_family") or {}).get("noul"), 0.0)
                if wrong >= 0.7:
                    score_100 = min(score_100, 45)
                elif wrong >= 0.55:
                    score_100 = min(score_100, 58)
                decision = (answers.get("decision") or {}).get("choice") or ""
                why = (
                    f"Laya on JD/CV vectors. Overlap {', '.join(overlap) or 'none'}. "
                    f"Missing {', '.join(missing) or 'none'}. Fit {raw_fit_f:.1f}/{max_level}."
                    + (f" Wrong family ({wrong:.2f})." if wrong >= 0.55 else "")
                    + (f" {decision}." if decision else "")
                )
                self._json(
                    200,
                    {
                        "score": score_100,
                        "coverage": cover,
                        "wrongFamily": wrong,
                        "decision": decision,
                        "why": why,
                        "answers": answers,
                    },
                )
                return
            if path == "/v1/score-person":
                jd_name = str(data.get("jdFileName") or "JD")[:160]
                jd_text = str(data.get("jdText") or "")[:500]
                person = data.get("person") if isinstance(data.get("person"), dict) else {}
                mandatory = data.get("mandatorySkills")
                if not isinstance(mandatory, list):
                    mandatory = []
                mandatory = [str(s).strip() for s in mandatory if str(s).strip()][:8]
                state = {
                    "job": {
                        "file": jd_name,
                        "title": str(data.get("jdTitle") or "")[:80],
                        "mandatory": mandatory,
                        "text": jd_text,
                    },
                    "person": {
                        "id": str(person.get("employee_id") or "")[:40],
                        "name": str(person.get("full_name") or "")[:80],
                        "designation": str(person.get("designation") or "")[:80],
                        "grade": str(person.get("grade") or "")[:20],
                        "skills": str(person.get("skills") or "")[:400],
                    },
                }
                result = predict(state, person_questions(mandatory))
                answers = result["answers"]
                coverage, hits, misses = coverage_from_answers(answers, mandatory)
                fit = answers.get("fit") or {}
                raw_fit_f = _num(fit.get("score"), 0.0)
                max_level = max(1, len(FIT_LEVELS) - 1)
                fit_100 = int(round(max(0.0, min(1.0, raw_fit_f / max_level)) * 100))
                coverage_100 = int(round(coverage * 100)) if mandatory else fit_100
                if mandatory:
                    score_100 = int(round(0.8 * coverage_100 + 0.2 * fit_100))
                else:
                    score_100 = fit_100
                wrong = _num((answers.get("wrong_family") or {}).get("noul"), 0.0)
                if wrong >= 0.7:
                    score_100 = min(score_100, 45)
                elif wrong >= 0.55:
                    score_100 = min(score_100, 58)
                decision = (answers.get("decision") or {}).get("choice") or ""
                why = (
                    f"Laya coverage {coverage_100}% on mandatory skills"
                    + (f" (has: {', '.join(hits)})" if hits else "")
                    + (f"; missing: {', '.join(misses)}" if misses else "")
                    + f". Fit {raw_fit_f:.1f}/{max_level}."
                    + (f" Wrong family ({wrong:.2f})." if wrong >= 0.55 else "")
                    + (f" Action {decision}." if decision else "")
                )
                self._json(
                    200,
                    {
                        "score": score_100,
                        "coverage": coverage_100,
                        "fit": raw_fit_f,
                        "wrongFamily": wrong,
                        "hits": hits,
                        "misses": misses,
                        "decision": decision,
                        "confidence": fit.get("confidence"),
                        "why": why,
                        "answers": answers,
                    },
                )
                return
            if path == "/v1/decide":
                state = data.get("state")
                questions = data.get("questions")
                if state is None or not isinstance(questions, dict):
                    self._json(400, {"error": "need state and questions"})
                    return
                self._json(200, predict(state, questions))
                return
            self._json(404, {"error": "not found"})
        except Exception as exc:
            traceback.print_exc()
            self._json(500, {"error": str(exc)})


def main():
    load_agent()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        f"Laya API on http://{HOST}:{PORT}  (GET /health, POST /v1/classify-file, POST /v1/score-person, POST /v1/decide)",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nLaya stopped.", flush=True)


if __name__ == "__main__":
    main()

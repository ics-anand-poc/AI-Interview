-- ============================================================
-- Resume Intelligence Platform - Phase 4 Schema Upgrade
-- Run this in the Supabase SQL Editor → https://supabase.co/dashboard/sql
--
-- Adds storage for rubric-based interview answer grading:
--   - interview_questions.grading_rubric: the "answer key" (key concepts,
--     model answer summary) generated alongside each question, used to
--     ground both the primary LLM evaluation and the local fallback grader.
--   - interview_attempts.score_breakdown: the per-dimension rubric scores
--     (Understanding/Relation, Keywords, Reasoning, Clarity) behind the
--     total score, for transparency and auditability.
--
-- Both are additive, nullable columns — existing rows and existing code
-- paths that don't know about them continue to work unchanged.
-- ============================================================

ALTER TABLE interview_questions
  ADD COLUMN IF NOT EXISTS grading_rubric jsonb;

ALTER TABLE interview_attempts
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb;

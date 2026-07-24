import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import crypto from "crypto";
import { supabase } from "@/lib/db";
import { 
  EvaluationRecord, 
  BehaviorEvaluation, 
  BusinessImpact 
} from "@/types/effectiveness";

interface EffectivenessDB {
  evaluations: EvaluationRecord[];
  behavior_evaluations: BehaviorEvaluation[];
  business_impacts: BusinessImpact[];
}

export class EffectivenessService {
  private static instance: EffectivenessService;
  private dbCache: EffectivenessDB | null = null;

  static getInstance(): EffectivenessService {
    if (!EffectivenessService.instance) {
      EffectivenessService.instance = new EffectivenessService();
    }
    return EffectivenessService.instance;
  }

  private isTableMissingError(error: any): boolean {
    return error && (error.code === "PGRST205" || String(error.message).includes("Could not find the table") || String(error.message).includes("does not exist"));
  }

  private mapRowToEvaluation(row: any): EvaluationRecord {
    return {
      id: row.id,
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      department: row.department,
      subject_id: row.subject_id,
      subject_title: row.subject_title,
      pre_test_score: row.pre_test_score,
      post_test_score: row.post_test_score,
      learning_gain_pct: Number(row.learning_gain_pct || 0),
      reaction_relevance: row.reaction_relevance ?? undefined,
      reaction_utility: row.reaction_utility ?? undefined,
      reaction_instructor: row.reaction_instructor ?? undefined,
      reaction_nps: row.reaction_nps ?? undefined,
      reaction_comments: row.reaction_comments ?? undefined,
      reaction_submitted_at: row.reaction_submitted_at ?? undefined,
      bloom_scores: row.bloom_scores || undefined,
      bloom_submissions: row.bloom_submissions || undefined,
      bloom_graded: row.bloom_graded || undefined,
      bloom_graded_by: row.bloom_graded_by ?? undefined,
      bloom_graded_at: row.bloom_graded_at ?? undefined,
      completion_date: row.completion_date,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private mapRowToBehaviorEvaluation(row: any): BehaviorEvaluation {
    return {
      id: row.id,
      employee_id: row.employee_id,
      subject_id: row.subject_id,
      evaluator_role: row.evaluator_role,
      evaluator_email: row.evaluator_email,
      interval_days: row.interval_days,
      q1_demonstrates_skills: row.q1_demonstrates_skills,
      q2_independently_applies: row.q2_independently_applies,
      q3_shares_learning: row.q3_shares_learning,
      q4_solves_problems: row.q4_solves_problems,
      q5_measurable_improvement: row.q5_measurable_improvement,
      comments: row.comments || "",
      submitted_at: row.submitted_at
    };
  }

  private mapRowToBusinessImpact(row: any): BusinessImpact {
    return {
      id: row.id,
      employee_id: row.employee_id,
      subject_id: row.subject_id,
      productivity_before: row.productivity_before,
      productivity_after: row.productivity_after,
      productivity_metric: row.productivity_metric,
      quality_before: row.quality_before,
      quality_after: row.quality_after,
      quality_metric: row.quality_metric,
      customer_csat_before: row.customer_csat_before,
      customer_csat_after: row.customer_csat_after,
      cost_reduction: Number(row.cost_reduction || 0),
      time_saved_hours: Number(row.time_saved_hours || 0),
      roi_score: Number(row.roi_score || 0),
      business_impact_score: row.business_impact_score,
      approved_by_pm: !!row.approved_by_pm,
      approved_by_rm: !!row.approved_by_rm,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private getStoragePath() {
    const root = process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
    return join(root, "effectiveness_eval_db.json");
  }

  private async ensureStorageDirectory() {
    const root = process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
    await mkdir(root, { recursive: true });
  }

  async loadDB(): Promise<EffectivenessDB> {
    if (this.dbCache) {
      return this.dbCache;
    }
    const path = this.getStoragePath();
    try {
      if (!existsSync(path)) {
        await this.ensureStorageDirectory();
        const initial = this.getSeedData();
        await writeFile(path, JSON.stringify(initial, null, 2), "utf8");
        this.dbCache = initial;
        return initial;
      }
      const raw = await readFile(path, "utf8");
      const db = JSON.parse(raw);
      this.dbCache = {
        evaluations: Array.isArray(db.evaluations) ? db.evaluations : [],
        behavior_evaluations: Array.isArray(db.behavior_evaluations) ? db.behavior_evaluations : [],
        business_impacts: Array.isArray(db.business_impacts) ? db.business_impacts : [],
      };
      return this.dbCache;
    } catch (error) {
      console.error("Failed to load effectiveness DB:", error);
      const initial = this.getSeedData();
      this.dbCache = initial;
      return initial;
    }
  }

  async saveDB(db: EffectivenessDB) {
    this.dbCache = db;
    await this.ensureStorageDirectory();
    await writeFile(this.getStoragePath(), JSON.stringify(db, null, 2), "utf8");
  }

  // ---------------------------------------------------------------------------
  // Evaluations Queries & Mutations
  // ---------------------------------------------------------------------------
  async getEvaluationsForEmployee(employeeId: string): Promise<EvaluationRecord[]> {
    try {
      const { data, error } = await supabase
        .from("evaluations")
        .select("*")
        .eq("employee_id", employeeId);

      if (error) {
        if (this.isTableMissingError(error)) throw error;
        console.error("Supabase getEvaluationsForEmployee error:", error.message);
        return [];
      }
      return (data || []).map(r => this.mapRowToEvaluation(r));
    } catch (dbErr) {
      console.warn("EffectivenessService.getEvaluationsForEmployee failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      return db.evaluations.filter((e) => e.employee_id === employeeId);
    }
  }

  async getEvaluationById(id: string): Promise<EvaluationRecord | null> {
    try {
      const { data, error } = await supabase
        .from("evaluations")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        if (this.isTableMissingError(error)) throw error;
        console.error("Supabase getEvaluationById error:", error.message);
        return null;
      }
      return data ? this.mapRowToEvaluation(data) : null;
    } catch (dbErr) {
      console.warn("EffectivenessService.getEvaluationById failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      return db.evaluations.find((e) => e.id === id) ?? null;
    }
  }

  async getEvaluationBySubject(employeeId: string, subjectId: string): Promise<EvaluationRecord | null> {
    try {
      const { data, error } = await supabase
        .from("evaluations")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("subject_id", subjectId)
        .maybeSingle();

      if (error) {
        if (this.isTableMissingError(error)) throw error;
        console.error("Supabase getEvaluationBySubject error:", error.message);
        return null;
      }
      return data ? this.mapRowToEvaluation(data) : null;
    } catch (dbErr) {
      console.warn("EffectivenessService.getEvaluationBySubject failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      return db.evaluations.find((e) => e.employee_id === employeeId && e.subject_id === subjectId) ?? null;
    }
  }

  async saveEvaluation(record: Omit<EvaluationRecord, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<EvaluationRecord> {
    const now = new Date().toISOString();
    try {
      let query: any;
      if (record.id) {
        query = supabase
          .from("evaluations")
          .upsert({
            id: record.id,
            employee_id: record.employee_id,
            employee_name: record.employee_name,
            department: record.department,
            subject_id: record.subject_id,
            subject_title: record.subject_title,
            pre_test_score: record.pre_test_score,
            post_test_score: record.post_test_score,
            learning_gain_pct: record.learning_gain_pct,
            reaction_relevance: record.reaction_relevance,
            reaction_utility: record.reaction_utility,
            reaction_instructor: record.reaction_instructor,
            reaction_nps: record.reaction_nps,
            reaction_comments: record.reaction_comments,
            reaction_submitted_at: record.reaction_submitted_at,
            bloom_scores: record.bloom_scores,
            bloom_submissions: record.bloom_submissions,
            bloom_graded: record.bloom_graded,
            bloom_graded_by: record.bloom_graded_by,
            bloom_graded_at: record.bloom_graded_at,
            completion_date: record.completion_date,
            updated_at: now
          })
          .select()
          .single();
      } else {
        query = supabase
          .from("evaluations")
          .insert({
            employee_id: record.employee_id,
            employee_name: record.employee_name,
            department: record.department,
            subject_id: record.subject_id,
            subject_title: record.subject_title,
            pre_test_score: record.pre_test_score,
            post_test_score: record.post_test_score,
            learning_gain_pct: record.learning_gain_pct,
            reaction_relevance: record.reaction_relevance,
            reaction_utility: record.reaction_utility,
            reaction_instructor: record.reaction_instructor,
            reaction_nps: record.reaction_nps,
            reaction_comments: record.reaction_comments,
            reaction_submitted_at: record.reaction_submitted_at,
            bloom_scores: record.bloom_scores,
            bloom_submissions: record.bloom_submissions,
            bloom_graded: record.bloom_graded,
            bloom_graded_by: record.bloom_graded_by,
            bloom_graded_at: record.bloom_graded_at,
            completion_date: record.completion_date,
            created_at: now,
            updated_at: now
          })
          .select()
          .single();
      }

      const { data, error } = await query;
      if (error) throw error;
      return this.mapRowToEvaluation(data);
    } catch (dbErr) {
      console.warn("EffectivenessService.saveEvaluation failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      if (record.id) {
        const idx = db.evaluations.findIndex((e) => e.id === record.id);
        if (idx !== -1) {
          const existing = db.evaluations[idx];
          const updated: EvaluationRecord = {
            ...existing,
            ...record,
            id: record.id,
            updated_at: now,
          };
          db.evaluations[idx] = updated;
          await this.saveDB(db);
          return updated;
        }
      }

      const existingIdx = db.evaluations.findIndex((e) => e.employee_id === record.employee_id && e.subject_id === record.subject_id);
      if (existingIdx !== -1) {
        const existing = db.evaluations[existingIdx];
        const updated: EvaluationRecord = {
          ...existing,
          ...record,
          updated_at: now,
        };
        db.evaluations[existingIdx] = updated;
        await this.saveDB(db);
        return updated;
      }

      const newRecord: EvaluationRecord = {
        ...record,
        id: record.id || crypto.randomUUID(),
        created_at: now,
        updated_at: now,
      };
      db.evaluations.push(newRecord);
      await this.saveDB(db);
      return newRecord;
    }
  }

  // ---------------------------------------------------------------------------
  // Behavior Evaluations Queries & Mutations
  // ---------------------------------------------------------------------------
  async getBehaviorEvaluations(employeeId: string, subjectId: string): Promise<BehaviorEvaluation[]> {
    try {
      const { data, error } = await supabase
        .from("behavior_evaluations")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("subject_id", subjectId);

      if (error) {
        if (this.isTableMissingError(error)) throw error;
        console.error("Supabase getBehaviorEvaluations error:", error.message);
        return [];
      }
      return (data || []).map(r => this.mapRowToBehaviorEvaluation(r));
    } catch (dbErr) {
      console.warn("EffectivenessService.getBehaviorEvaluations failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      return db.behavior_evaluations.filter(
        (b) => b.employee_id === employeeId && b.subject_id === subjectId
      );
    }
  }

  async saveBehaviorEvaluation(evalRecord: Omit<BehaviorEvaluation, "id" | "submitted_at"> & { id?: string }): Promise<BehaviorEvaluation> {
    const now = new Date().toISOString();
    try {
      const payload = {
        id: evalRecord.id || crypto.randomUUID(),
        employee_id: evalRecord.employee_id,
        subject_id: evalRecord.subject_id,
        evaluator_role: evalRecord.evaluator_role,
        evaluator_email: evalRecord.evaluator_email,
        interval_days: evalRecord.interval_days,
        q1_demonstrates_skills: evalRecord.q1_demonstrates_skills,
        q2_independently_applies: evalRecord.q2_independently_applies,
        q3_shares_learning: evalRecord.q3_shares_learning,
        q4_solves_problems: evalRecord.q4_solves_problems,
        q5_measurable_improvement: evalRecord.q5_measurable_improvement,
        comments: evalRecord.comments,
        submitted_at: now
      };

      const { data, error } = await supabase
        .from("behavior_evaluations")
        .upsert(payload)
        .select()
        .single();

      if (error) throw error;
      return this.mapRowToBehaviorEvaluation(data);
    } catch (dbErr) {
      console.warn("EffectivenessService.saveBehaviorEvaluation failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      const existingIdx = db.behavior_evaluations.findIndex(
        (b) => b.employee_id === evalRecord.employee_id && 
               b.subject_id === evalRecord.subject_id && 
               b.evaluator_role === evalRecord.evaluator_role &&
               b.interval_days === evalRecord.interval_days
      );

      if (existingIdx !== -1) {
        const updated: BehaviorEvaluation = {
          ...db.behavior_evaluations[existingIdx],
          ...evalRecord,
          submitted_at: now,
        };
        db.behavior_evaluations[existingIdx] = updated;
        await this.saveDB(db);
        return updated;
      }

      const newEval: BehaviorEvaluation = {
        ...evalRecord,
        id: evalRecord.id || crypto.randomUUID(),
        submitted_at: now,
      };
      db.behavior_evaluations.push(newEval);
      await this.saveDB(db);
      return newEval;
    }
  }

  // ---------------------------------------------------------------------------
  // Business Impacts Queries & Mutations
  // ---------------------------------------------------------------------------
  async getBusinessImpact(employeeId: string, subjectId: string): Promise<BusinessImpact | null> {
    try {
      const { data, error } = await supabase
        .from("business_impacts")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("subject_id", subjectId)
        .maybeSingle();

      if (error) {
        if (this.isTableMissingError(error)) throw error;
        console.error("Supabase getBusinessImpact error:", error.message);
        return null;
      }
      return data ? this.mapRowToBusinessImpact(data) : null;
    } catch (dbErr) {
      console.warn("EffectivenessService.getBusinessImpact failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      return db.business_impacts.find((b) => b.employee_id === employeeId && b.subject_id === subjectId) ?? null;
    }
  }

  async saveBusinessImpact(impact: Omit<BusinessImpact, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<BusinessImpact> {
    const now = new Date().toISOString();
    try {
      const payload = {
        id: impact.id || crypto.randomUUID(),
        employee_id: impact.employee_id,
        subject_id: impact.subject_id,
        productivity_before: impact.productivity_before,
        productivity_after: impact.productivity_after,
        productivity_metric: impact.productivity_metric,
        quality_before: impact.quality_before,
        quality_after: impact.quality_after,
        quality_metric: impact.quality_metric,
        customer_csat_before: impact.customer_csat_before,
        customer_csat_after: impact.customer_csat_after,
        cost_reduction: impact.cost_reduction,
        time_saved_hours: impact.time_saved_hours,
        roi_score: impact.roi_score,
        business_impact_score: impact.business_impact_score,
        approved_by_pm: impact.approved_by_pm,
        approved_by_rm: impact.approved_by_rm,
        created_at: (impact as any).created_at || now,
        updated_at: now
      };

      const { data, error } = await supabase
        .from("business_impacts")
        .upsert(payload)
        .select()
        .single();

      if (error) throw error;
      return this.mapRowToBusinessImpact(data);
    } catch (dbErr) {
      console.warn("EffectivenessService.saveBusinessImpact failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      const existingIdx = db.business_impacts.findIndex(
        (b) => b.employee_id === impact.employee_id && b.subject_id === impact.subject_id
      );

      if (existingIdx !== -1) {
        const updated: BusinessImpact = {
          ...db.business_impacts[existingIdx],
          ...impact,
          updated_at: now,
        };
        db.business_impacts[existingIdx] = updated;
        await this.saveDB(db);
        return updated;
      }

      const newImpact: BusinessImpact = {
        ...impact,
        id: impact.id || crypto.randomUUID(),
        created_at: now,
        updated_at: now,
      };
      db.business_impacts.push(newImpact);
      await this.saveDB(db);
      return newImpact;
    }
  }

  // ---------------------------------------------------------------------------
  // Seed Mock Data
  // ---------------------------------------------------------------------------
  private getSeedData(): EffectivenessDB {
    const now = new Date();
    
    const daysAgo = (n: number) => {
      const d = new Date(now);
      d.setDate(now.getDate() - n);
      return d.toISOString();
    };

    const sofiaId = "EMP001";
    const aryanmiId = "EMP2537";

    const evaluations: EvaluationRecord[] = [
      {
        id: "eval-sofia-ai",
        employee_id: sofiaId,
        employee_name: "Sofia Reddy",
        department: "engineering",
        subject_id: "ai",
        subject_title: "Artificial Intelligence",
        pre_test_score: 40,
        post_test_score: 85,
        learning_gain_pct: 112.5,
        reaction_relevance: 5,
        reaction_utility: 5,
        reaction_instructor: 4,
        reaction_nps: 9,
        reaction_comments: "Excellent overview of AI concepts. Hands-on projects were useful.",
        reaction_submitted_at: daysAgo(94),
        bloom_scores: {
          remember: 90,
          understand: 85,
          apply: 80,
          analyze: 85,
          evaluate: 90,
          create: 80,
        },
        bloom_submissions: {
          apply_evidence: "Implemented search algorithms in visual puzzle project.",
          analyze_text: "Conducted problem diagnosis using BFS/DFS heuristics for optimal routing.",
          evaluate_text: "Compared heuristic vs brute force algorithms, evaluating complexity trade-offs.",
          create_text: "Created a custom pathfinding package for spatial navigation in grid layouts.",
        },
        bloom_graded: {
          apply_score: 80,
          analyze_score: 85,
          evaluate_score: 90,
          create_score: 80,
        },
        bloom_graded_by: "manager@infinite.com",
        bloom_graded_at: daysAgo(90),
        completion_date: daysAgo(95),
        created_at: daysAgo(96),
        updated_at: daysAgo(90),
      },
      {
        id: "eval-sofia-ml",
        employee_id: sofiaId,
        employee_name: "Sofia Reddy",
        department: "engineering",
        subject_id: "ml",
        subject_title: "Machine Learning",
        pre_test_score: 50,
        post_test_score: 80,
        learning_gain_pct: 60,
        reaction_relevance: 4,
        reaction_utility: 4,
        reaction_instructor: 5,
        reaction_nps: 8,
        reaction_comments: "Loved learning SVMs and regression pipelines. Very detail-oriented.",
        reaction_submitted_at: daysAgo(44),
        bloom_scores: {
          remember: 80,
          understand: 75,
          apply: 75,
          analyze: 70,
          evaluate: 65,
          create: 60,
        },
        bloom_submissions: {
          apply_evidence: "Created linear regression workflow to predict team ticket volumes.",
          analyze_text: "Performed feature selection analysis to identify root causes of model errors.",
          evaluate_text: "Compared performance between XGBoost and SVM models for user categorization.",
          create_text: "Proposed an automated feature engineering pipeline workflow for CSV datasets.",
        },
        bloom_graded: {
          apply_score: 75,
          analyze_score: 70,
          evaluate_score: 65,
          create_score: 60,
        },
        bloom_graded_by: "manager@infinite.com",
        bloom_graded_at: daysAgo(40),
        completion_date: daysAgo(45),
        created_at: daysAgo(46),
        updated_at: daysAgo(40),
      },
      {
        id: "eval-sofia-ds",
        employee_id: sofiaId,
        employee_name: "Sofia Reddy",
        department: "engineering",
        subject_id: "ds",
        subject_title: "Data Science",
        pre_test_score: 35,
        post_test_score: 0,
        learning_gain_pct: 0,
        completion_date: daysAgo(2),
        created_at: daysAgo(2),
        updated_at: daysAgo(2),
      },
      {
        id: "eval-aryan-py",
        employee_id: aryanmiId,
        employee_name: "Aryanmi",
        department: "engineering",
        subject_id: "s4",
        subject_title: "Python",
        pre_test_score: 60,
        post_test_score: 95,
        learning_gain_pct: 58.33,
        reaction_relevance: 5,
        reaction_utility: 5,
        reaction_instructor: 5,
        reaction_nps: 10,
        reaction_comments: "Python mastery training has streamlined all my backend tasks.",
        reaction_submitted_at: daysAgo(91),
        bloom_scores: {
          remember: 100,
          understand: 90,
          apply: 95,
          analyze: 85,
          evaluate: 90,
          create: 95,
        },
        bloom_submissions: {
          apply_evidence: "Refactored parsing script with clean decorators and generator patterns.",
          analyze_text: "Completed thread safety and multiprocessing bottleneck profiling.",
          evaluate_text: "Evaluated asyncio vs multithreading approaches for concurrent HTTP scrapers.",
          create_text: "Created a customized logging utility framework for system activity tracking.",
        },
        bloom_graded: {
          apply_score: 95,
          analyze_score: 85,
          evaluate_score: 90,
          create_score: 95,
        },
        bloom_graded_by: "manager@infinite.com",
        bloom_graded_at: daysAgo(88),
        completion_date: daysAgo(92),
        created_at: daysAgo(93),
        updated_at: daysAgo(88),
      }
    ];

    const behavior_evaluations: BehaviorEvaluation[] = [
      {
        id: "beh-sofia-ai-30",
        employee_id: sofiaId,
        subject_id: "ai",
        evaluator_role: "RM",
        evaluator_email: "rm.manager@infinite.com",
        interval_days: 30,
        q1_demonstrates_skills: 4,
        q2_independently_applies: 4,
        q3_shares_learning: 4,
        q4_solves_problems: 5,
        q5_measurable_improvement: 4,
        comments: "Sofia is applying search algorithm concepts to restructure visual rendering trees. Good improvement.",
        submitted_at: daysAgo(65),
      },
      {
        id: "beh-sofia-ai-30-pm",
        employee_id: sofiaId,
        subject_id: "ai",
        evaluator_role: "PM",
        evaluator_email: "pm.director@infinite.com",
        interval_days: 30,
        q1_demonstrates_skills: 4,
        q2_independently_applies: 3,
        q3_shares_learning: 5,
        q4_solves_problems: 4,
        q5_measurable_improvement: 4,
        comments: "Excellent collaboration. Shares AI concept decks with engineering peers regularly.",
        submitted_at: daysAgo(64),
      },
      {
        id: "beh-sofia-ai-60",
        employee_id: sofiaId,
        subject_id: "ai",
        evaluator_role: "RM",
        evaluator_email: "rm.manager@infinite.com",
        interval_days: 60,
        q1_demonstrates_skills: 5,
        q2_independently_applies: 4,
        q3_shares_learning: 4,
        q4_solves_problems: 5,
        q5_measurable_improvement: 5,
        comments: "Demonstrating high autonomy now. Solved a critical routing puzzle in staging.",
        submitted_at: daysAgo(35),
      },
      {
        id: "beh-sofia-ai-90",
        employee_id: sofiaId,
        subject_id: "ai",
        evaluator_role: "RM",
        evaluator_email: "rm.manager@infinite.com",
        interval_days: 90,
        q1_demonstrates_skills: 5,
        q2_independently_applies: 5,
        q3_shares_learning: 4,
        q4_solves_problems: 5,
        q5_measurable_improvement: 5,
        comments: "Outstanding mastery. Fully transformed her daily workflow with AI practices.",
        submitted_at: daysAgo(5),
      },
      {
        id: "beh-sofia-ml-30",
        employee_id: sofiaId,
        subject_id: "ml",
        evaluator_role: "RM",
        evaluator_email: "rm.manager@infinite.com",
        interval_days: 30,
        q1_demonstrates_skills: 4,
        q2_independently_applies: 3,
        q3_shares_learning: 3,
        q4_solves_problems: 4,
        q5_measurable_improvement: 3,
        comments: "Setting up basic regression modules. Applying core concepts, needs validation support.",
        submitted_at: daysAgo(15),
      },
      {
        id: "beh-aryan-py-30",
        employee_id: aryanmiId,
        subject_id: "s4",
        evaluator_role: "RM",
        evaluator_email: "rm.manager@infinite.com",
        interval_days: 30,
        q1_demonstrates_skills: 5,
        q2_independently_applies: 4,
        q3_shares_learning: 5,
        q4_solves_problems: 4,
        q5_measurable_improvement: 4,
        comments: "Aryan refactored several critical python cron scripts. Performance improved by 20%.",
        submitted_at: daysAgo(60),
      },
      {
        id: "beh-aryan-py-60",
        employee_id: aryanmiId,
        subject_id: "s4",
        evaluator_role: "RM",
        evaluator_email: "rm.manager@infinite.com",
        interval_days: 60,
        q1_demonstrates_skills: 5,
        q2_independently_applies: 5,
        q3_shares_learning: 4,
        q4_solves_problems: 5,
        q5_measurable_improvement: 5,
        comments: "Excellent grasp of concurrency issues. Solved multiprocessing deadlocks.",
        submitted_at: daysAgo(30),
      },
      {
        id: "beh-aryan-py-90",
        employee_id: aryanmiId,
        subject_id: "s4",
        evaluator_role: "RM",
        evaluator_email: "rm.manager@infinite.com",
        interval_days: 90,
        q1_demonstrates_skills: 5,
        q2_independently_applies: 5,
        q3_shares_learning: 5,
        q4_solves_problems: 5,
        q5_measurable_improvement: 5,
        comments: "Consistently demonstrating expert patterns. Mentoring junior staff.",
        submitted_at: daysAgo(2),
      }
    ];

    const business_impacts: BusinessImpact[] = [
      {
        id: "imp-sofia-ai",
        employee_id: sofiaId,
        subject_id: "ai",
        productivity_before: 70,
        productivity_after: 85,
        productivity_metric: "Task Completion Rate",
        quality_before: 90,
        quality_after: 98,
        quality_metric: "Visual Module Defect-Free %",
        customer_csat_before: 82,
        customer_csat_after: 94,
        cost_reduction: 4500,
        time_saved_hours: 12,
        roi_score: 220,
        business_impact_score: 92,
        approved_by_pm: true,
        approved_by_rm: true,
        created_at: daysAgo(5),
        updated_at: daysAgo(5),
      },
      {
        id: "imp-aryan-py",
        employee_id: aryanmiId,
        subject_id: "s4",
        productivity_before: 60,
        productivity_after: 90,
        productivity_metric: "Build Delivery Speed",
        quality_before: 85,
        quality_after: 99,
        quality_metric: "Parsing Automation Clean Rate",
        customer_csat_before: 78,
        customer_csat_after: 95,
        cost_reduction: 8000,
        time_saved_hours: 24,
        roi_score: 433.3,
        business_impact_score: 96,
        approved_by_pm: true,
        approved_by_rm: true,
        created_at: daysAgo(2),
        updated_at: daysAgo(2),
      }
    ];

    return {
      evaluations,
      behavior_evaluations,
      business_impacts,
    };
  }
}

export const effectivenessService = EffectivenessService.getInstance();

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";

/**
 * GET /api/employee/subjects
 * Returns all active learning_subjects for the employee portal home page.
 */
export async function GET() {
  try {
    // Hardcoded subjects for now; replaced with DB query after employee schema is provisioned
    const subjects = [
      {
        id: "ai", title: "Artificial Intelligence",
        description: "Learn the fundamentals of AI, including search algorithms, logic, and expert systems.",
        icon: "Brain", color: "#3b82f6",
      },
      {
        id: "ml", title: "Machine Learning",
        description: "Master supervised, unsupervised, and reinforcement learning techniques.",
        icon: "Activity", color: "#8b5cf6",
      },
      {
        id: "python", title: "Python Programming",
        description: "Build strong Python skills from fundamentals to advanced data structures.",
        icon: "Code", color: "#06b6d4",
      },
      {
        id: "sql", title: "SQL & Databases",
        description: "Learn database design, queries, and optimization for data analysis.",
        icon: "Database", color: "#14b8a6",
      },
      {
        id: "cloud", title: "Cloud Computing",
        description: "Explore AWS, GCP, and Azure cloud platforms and architectures.",
        icon: "Cloud", color: "#f59e0b",
      },
      {
        id: "mlops", title: "MLOps & Deployment",
        description: "Deploy and manage machine learning models in production environments.",
        icon: "Zap", color: "#ef4444",
      },
    ];

    return NextResponse.json(subjects);
  } catch (e: any) {
    console.error("GET /api/employee/subjects error:", e);
    return NextResponse.json({ error: e.message ?? "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/employee/subjects
 * Admin-only: create a new learning_subject row.
 */
export async function POST(request: NextRequest) {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: emp } = await supabase.from("employees").select("role").eq("id", user.id).single();
    if (emp?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { title, description, icon = "BookOpen", color = "#3b82f6", order_index = 0 } = body;

    const { data, error: insErr } = await supabase
      .from("learning_subjects")
      .insert({ title, description, icon, color, order_index })
      .select()
      .single();

    if (insErr) throw insErr;
    return NextResponse.json(data);
  } catch (e: any) {
    console.error("POST /employee/subjects error:", e);
    return NextResponse.json({ error: e.message ?? "Internal error" }, { status: 500 });
  }
}

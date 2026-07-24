"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  Loader2,
  TrendingUp,
  Award,
  Zap,
  Activity,
  DollarSign,
  AlertCircle,
} from "lucide-react";

export function AdminEffectivenessTab() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? window.sessionStorage.getItem("admin_token") || "" : "";
    fetchData(token);
  }, []);

  async function fetchData(token: string) {
    try {
      setLoading(true);
      const res = await fetch("/api/employee/effectiveness/analytics?scope=hr", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      if (!res.ok) throw new Error("Failed to load HR effectiveness metrics.");
      const d = await res.json();
      if (d.success) {
        setData(d);
      } else {
        throw new Error(d.error || "Unknown error");
      }
    } catch (e: any) {
      setErr(e.message || "An error occurred.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        <p className="text-slate-500 font-bold text-sm">Loading effectiveness analytics…</p>
      </div>
    );
  }

  if (err) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 shadow-soft p-10 text-center text-red-600 dark:text-red-400">
        <AlertCircle className="w-8 h-8 mx-auto mb-3" />
        {err}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8 animate-fade-in">
      
      {/* Overview Stats Row */}
      <section className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="p-5 flex flex-col justify-between bg-slate-50/50 dark:bg-slate-900/50 border border-indigo-50 dark:border-slate-800 shadow-sm text-center">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Overall ROI</span>
          <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{data.overall_roi}%</span>
          <span className="text-[10px] text-slate-400 block mt-1">Cost Benefits Ratio</span>
        </Card>

        <Card className="p-5 flex flex-col justify-between bg-slate-50/50 dark:bg-slate-900/50 border border-indigo-50 dark:border-slate-800 shadow-sm text-center">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Effectiveness Index</span>
          <span className="text-3xl font-black text-indigo-600 dark:text-violet-400">{data.training_effectiveness_index}%</span>
          <span className="text-[10px] text-slate-400 block mt-1">Average Kirkpatrick TEI</span>
        </Card>

        <Card className="p-5 flex flex-col justify-between bg-slate-50/50 dark:bg-slate-900/50 border border-indigo-50 dark:border-slate-800 shadow-sm text-center">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Total Cost Savings</span>
          <span className="text-3xl font-black text-slate-800 dark:text-slate-200">${data.total_savings.toLocaleString()}</span>
          <span className="text-[10px] text-slate-400 block mt-1">Direct Business Returns</span>
        </Card>

        <Card className="p-5 flex flex-col justify-between bg-slate-50/50 dark:bg-slate-900/50 border border-indigo-50 dark:border-slate-800 shadow-sm text-center">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Net ROI Benefits</span>
          <span className="text-3xl font-black text-slate-800 dark:text-slate-200">${(data.total_savings - data.total_cost).toLocaleString()}</span>
          <span className="text-[10px] text-slate-400 block mt-1">Cost: ${data.total_cost.toLocaleString()}</span>
        </Card>
      </section>

      {/* Charts & Breakdown Grid */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Department effectiveness */}
        <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-50 dark:border-slate-800 shadow-sm">
          <h3 className="font-extrabold text-sm mb-4">Department-wise Effectiveness Index</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={data.department_effectiveness}>
                <XAxis dataKey="department" tick={{ fontSize: 10, fontWeight: "bold" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Tooltip />
                <Bar dataKey="avg_effectiveness" fill="#6366f1" radius={[4,4,0,0]} name="Effectiveness Index" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Skill Gap Analysis */}
        <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-50 dark:border-slate-800 shadow-sm">
          <h3 className="font-extrabold text-sm mb-4">Skill Gap Analysis &amp; Competency Averages</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={data.skill_gap_analysis}>
                <XAxis dataKey="subject_title" tick={{ fontSize: 10, fontWeight: "bold" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Tooltip />
                <Bar dataKey="avg_competency" fill="#10b981" radius={[4,4,0,0]} name="Average Competency %" />
                <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "Target (100%)", position: "top", fill: "#ef4444", fontSize: 9 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      {/* Program Rankings Table */}
      <Card className="p-6 bg-white dark:bg-slate-900 border border-indigo-50 dark:border-slate-800 shadow-sm">
        <h3 className="font-extrabold text-sm mb-4">High Impact Training Programs</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-indigo-50 dark:border-slate-800 text-slate-400 font-bold uppercase">
                <th className="py-3 px-4">Subject Program</th>
                <th className="py-3 px-4 text-center">Completed count</th>
                <th className="py-3 px-4 text-right">Effectiveness score (TEI)</th>
                <th className="py-3 px-4 text-right">Performance Band</th>
              </tr>
            </thead>
            <tbody>
              {data.high_impact_programs.map((item: any) => {
                const band = item.tei >= 85 ? "High Impact" : item.tei >= 70 ? "Moderate Impact" : "Low Impact";
                const bandColor = item.tei >= 85 
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border-emerald-100" 
                  : item.tei >= 70 
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-955/20 dark:text-amber-300 border-amber-100"
                    : "bg-red-50 text-red-700 dark:bg-red-955/20 dark:text-red-400 border-red-100";

                return (
                  <tr key={item.subject_id} className="border-b border-indigo-50 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-850/50 transition">
                    <td className="py-3.5 px-4 font-bold text-slate-800 dark:text-slate-200">{item.title}</td>
                    <td className="py-3.5 px-4 text-center text-slate-500 font-semibold">{item.completed_count} Employee{item.completed_count !== 1 ? "s" : ""}</td>
                    <td className="py-3.5 px-4 text-right font-black text-indigo-650 dark:text-violet-400">{item.tei}%</td>
                    <td className="py-3.5 px-4 text-right">
                      <span className={`px-2 py-0.5 border rounded-full font-bold text-[10px] ${bandColor}`}>{band}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
export default AdminEffectivenessTab;

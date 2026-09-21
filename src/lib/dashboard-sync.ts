import { supabaseServer } from "@/lib/db";

const SETTINGS_KEY = "dashboard_sync";

export type DashboardSyncState = {
  revision: number;
  at: string;
  source?: string;
};

function parseSyncValue(raw: unknown): DashboardSyncState {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const revision = Number(value.revision);
  return {
    revision: Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : 0,
    at: String(value.at || ""),
    source: String(value.source || ""),
  };
}

export async function readDashboardSync(): Promise<DashboardSyncState> {
  try {
    const { data, error } = await supabaseServer
      .from("portal_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (error) {
      console.warn("Failed to read dashboard sync:", error.message);
      return { revision: 0, at: "" };
    }
    return parseSyncValue(data?.value);
  } catch (err) {
    console.warn("Failed to read dashboard sync:", err);
    return { revision: 0, at: "" };
  }
}

export async function bumpDashboardSync(source = ""): Promise<void> {
  try {
    const current = await readDashboardSync();
    const next: DashboardSyncState = {
      revision: current.revision + 1,
      at: new Date().toISOString(),
      source: source.slice(0, 80),
    };
    const { error } = await supabaseServer.from("portal_settings").upsert(
      { key: SETTINGS_KEY, value: next },
      { onConflict: "key" }
    );
    if (error) {
      console.warn("Failed to bump dashboard sync:", error.message);
    }
  } catch (err) {
    console.warn("Failed to bump dashboard sync:", err);
  }
}

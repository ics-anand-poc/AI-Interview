import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { checkCsrf } from '@/lib/security';
import { 
  refreshRequirements, 
  refreshCandidates, 
  refreshEmployees, 
  refreshInterviews 
} from '@/services/automation-service';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

export async function POST(request: NextRequest) {
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const category = formData.get('category') as string || ''; // resume, jd, br, employee, interview
    const activeJdId = formData.get('activeJdId') as string || undefined;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const filename = file.name;
    const buffer = Buffer.from(await file.arrayBuffer());

    let targetDir = "";
    let triggerRefreshType = "";

    if (category === 'resume') {
      targetDir = join(process.cwd(), "docs", "Resumes");
      triggerRefreshType = "candidates";
    } else if (category === 'jd') {
      targetDir = join(process.cwd(), "docs", "JD");
      triggerRefreshType = "requirements";
    } else if (category === 'br') {
      targetDir = join(process.cwd(), "docs", "BR");
      triggerRefreshType = "requirements";
    } else if (category === 'employee') {
      targetDir = join(process.cwd(), "docs", "Corp Pool");
      triggerRefreshType = "employees";
    } else if (category === 'interview') {
      const csvPath = join(getUploadsRoot(), "candidate_interview_data.csv");
      await writeFile(csvPath, buffer);
      triggerRefreshType = "interviews";
    } else {
      return NextResponse.json({ error: "Invalid upload category" }, { status: 400 });
    }

    if (category !== 'interview') {
      await mkdir(targetDir, { recursive: true });
      const filePath = join(targetDir, filename);
      await writeFile(filePath, buffer);
    }

    // Trigger processing automatically based on refresh type
    let refreshResult: any = {};
    if (triggerRefreshType === 'requirements') {
      refreshResult = await refreshRequirements();
    } else if (triggerRefreshType === 'candidates') {
      refreshResult = await refreshCandidates(activeJdId);
    } else if (triggerRefreshType === 'employees') {
      refreshResult = await refreshEmployees(activeJdId);
    } else if (triggerRefreshType === 'interviews') {
      refreshResult = await refreshInterviews();
    }

    return NextResponse.json({ 
      success: true, 
      message: `File uploaded and processed successfully under ${category}.`,
      refreshResult 
    });

  } catch (error: any) {
    console.error("Unified upload error:", error);
    return NextResponse.json({ error: error.message || "Upload processing failed" }, { status: 500 });
  }
}

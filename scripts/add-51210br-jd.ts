/**
 * Add 51210BR Senior Software Engineer (Conduent / Java) as today's requirement.
 *
 * Usage: npx tsx scripts/add-51210br-jd.ts
 */
import { createHash } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, loadProjectEnv } from "./load-env";

loadProjectEnv();

function brIdToUuid(brId: string): string {
  const hash = createHash("md5").update(brId).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const ROOT = process.cwd();
const BR_ID = "51210BR";
const FILE = "51210BR.pdf";
const createdAt = "2026-09-17T12:15:00.000Z";

const JD_TEXT = `Job Title: Senior Software Engineer

Date: 17 Sep 2026

Mandatory Skills: Java, J2EE, REST APIs

Primary Skills: Java, J2EE, Spring Boot, Hibernate, SQL, PL/SQL, Servlets, JSP, SOAP, Microservices, Spring, Struts, React, Angular, Tomcat, Git, Jira

51210BR - Senior Software Engineer
Status: Open
Client: Conduent Business Services LLC
Project: Conduent - Transportation - BATA
Grade: E3
Location: Hyderabad (Bangalore/Hyderabad)
Experience: 3-6 years
Sourcing: External - India
Requirement type: Backfill (Rishab Ranjan / 1042978)
TAG / RMG Manager: Antony, Nithin (1027544)
Reports to: Reddy, Janardhana (1039901)

JOB DESCRIPTION:
Experience of Design, Implementation, Delivery & Maintenance of apps using Java/JavaEE technologies & compatible frameworks.

- Good communication skills, both written and verbal
- Experience in System Designing
- Experience in Code review of Junior resources
- Leading a small team (5-10 members); leads delivery of multiple modules
- Outstanding skills in Core Java (Java 7, 8/11), J2EE
- Strong Object-Oriented design and analysis skills
- Implementation, Delivery & Maintenance of Multi-Tier applications using Java, J2EE Technologies and related frameworks
- Working experience in Servlets, JSP
- Experience of RESTful web-services
- Experience of SOAP Web-services
- Good working knowledge of Design Patterns and Design Principles
- Experience of Spring Boot
- Experience/Knowledge of Micro-services
- Experience in Struts/Spring Framework, Hibernate/any ORM
- Working experience for SQL & PL/SQL, DB Design Skills
- Good working knowledge of Application & Web Servers; WebSphere or other application server; Tomcat or other webserver
- Good understanding of the Software Development life cycle
- Good understanding/knowledge of secure coding practices/standards; PCI, OWASP
- Experience of implementing projects/modules for high availability, high performance
- Experience of any Defect Management tool (e.g. Jira), Code Repository (SVN, GIT)
- Experience of JMS or EJB
- Knowledge of UI Frameworks – ReactJS/Angular
- Participates in Requirement analysis, Architectural discussions
- Creates high level & detailed design

Develops and tests software systems or applications for software enhancements and new products. Analyses, programs, and modifies software for enhancements and/or new products. Using current programming languages and technologies, writes code, completes programming, and performs testing and debugging of applications.
`.trim();

async function main() {
  const srcPdf = "C:/Users/Aryan/Downloads/51210BR.pdf";
  if (!existsSync(srcPdf)) throw new Error(`Missing ${srcPdf}`);

  mkdirSync(join(ROOT, "docs", "JD"), { recursive: true });
  mkdirSync(join(ROOT, "docs", "BR - Interviewscore App"), { recursive: true });
  writeFileSync(join(ROOT, "docs", "JD", "51210BR Senior Software Engineer.txt"), JD_TEXT, "utf8");
  copyFileSync(srcPdf, join(ROOT, "docs", "BR - Interviewscore App", FILE));
  copyFileSync(srcPdf, join(ROOT, "docs", "JD", FILE));

  const row = {
    id: brIdToUuid(BR_ID),
    jd_text: JD_TEXT,
    rm_email: "admin@infinite.com",
    file_name: `${BR_ID} | ${FILE}`,
    created_at: createdAt,
  };

  const { url, key } = getSupabaseConfig();
  if (url && key) {
    if (process.env.ALLOW_INSECURE_TLS === "1") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const supabase = createClient(url, key);
    const { data: existing, error: readErr } = await supabase
      .from("job_descriptions")
      .select("id, file_name")
      .eq("id", row.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (existing?.id) {
      const { error } = await supabase
        .from("job_descriptions")
        .update({
          jd_text: row.jd_text,
          file_name: row.file_name,
          created_at: row.created_at,
        })
        .eq("id", existing.id);
      if (error) throw error;
      console.log(`Updated existing ${existing.file_name || row.file_name}`);
    } else {
      const { error } = await supabase.from("job_descriptions").insert(row);
      if (error) throw error;
      console.log(`Inserted ${row.file_name} dated ${createdAt}`);
    }
  } else {
    console.warn("No Supabase config; writing local JSON only.");
  }

  const localPath = join(ROOT, "uploads", "job_descriptions.json");
  mkdirSync(join(ROOT, "uploads"), { recursive: true });
  let local: any[] = [];
  if (existsSync(localPath)) {
    try {
      local = JSON.parse(readFileSync(localPath, "utf8"));
    } catch {}
  }
  const idx = local.findIndex(
    (j) => j.id === row.id || String(j.fileName || "").toUpperCase().includes(BR_ID)
  );
  const localRow = {
    id: row.id,
    jdText: row.jd_text,
    rmEmail: row.rm_email,
    fileName: row.file_name,
    createdAt,
    uploadBatch: createdAt,
  };
  if (idx === -1) local.push(localRow);
  else local[idx] = { ...local[idx], ...localRow };
  writeFileSync(localPath, JSON.stringify(local, null, 2), "utf8");
  console.log(`Updated ${localPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

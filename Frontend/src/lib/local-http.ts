import http from "http";
import https from "https";
import { URL } from "url";

export function postJson<T = any>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 15000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = Buffer.from(JSON.stringify(body));
    const client = target.protocol === "https:" ? https : http;

    const req = client.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Request to ${url} failed with status ${res.statusCode}: ${raw}`));
            return;
          }
          try {
            resolve(raw ? JSON.parse(raw) : (undefined as T));
          } catch {
            reject(new Error(`Failed to parse JSON response from ${url}: ${raw}`));
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

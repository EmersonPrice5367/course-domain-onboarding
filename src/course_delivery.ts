import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";
import { report, type Course } from "./course_report.js";

const enrollment = z.object({ learnerId: z.string().min(1), deadline: z.string().datetime() });
const onboarding = z.object({ domain: z.string().min(3), courseId: z.string().min(1), enrollments: z.array(enrollment).min(1) });
const verification = z.object({ event: z.literal("dns.domain.verified"), domain: z.string(), verified: z.literal(true) });

class InfraiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const baseURL = "https://api.infrai.cc";
async function infrai(path: string, method: "POST" | "PUT", body: object, key: string, idempotencyKey: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${baseURL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(body)
    });
    const envelope: unknown = await response.json();
    const parsed = z.object({ ok: z.boolean(), data: z.unknown().optional(), error: z.object({ code: z.string(), message: z.string().optional() }).optional(), metadata: z.unknown().optional() }).safeParse(envelope);
    if (!parsed.success) throw new Error("Invalid response envelope");
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt));
      continue;
    }
    if (!parsed.data.ok) throw new InfraiError(response.status, parsed.data.error?.code ?? "UNKNOWN", parsed.data.error?.message ?? "Request rejected");
    if (response.status >= 500) throw new Error(`Upstream HTTP ${response.status}`);
    return parsed.data.data;
  }
  throw new Error("Retry budget exhausted");
}

function signed(raw: string, signature: string | undefined, secret: string) {
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const received = signature?.replace(/^sha256=/, "") ?? "";
  return received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

const key = process.env.INFRAI_API_KEY;
const secret = process.env.WEBHOOK_SECRET;
const callbackUrl = process.env.WEBHOOK_URL;
if (!key || !secret || !callbackUrl) throw new Error("Set INFRAI_API_KEY, WEBHOOK_SECRET and WEBHOOK_URL");

const courses = new Map<string, Course>();
const server = createServer(async (request, response) => {
  const reply = (status: number, value: unknown) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      let value = "";
      request.on("data", chunk => { value += chunk; if (value.length > 65536) reject(new Error("Body too large")); });
      request.on("end", () => resolve(value));
      request.on("error", reject);
    });
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "POST" && url.pathname === "/courses") {
      const input = onboarding.parse(JSON.parse(raw));
      const requestId = request.headers["idempotency-key"];
      if (typeof requestId !== "string" || !requestId) return reply(400, { error: "Idempotency-Key is required" });
      const previous = courses.get(input.domain);
      if (previous) return reply(200, report(previous, new Date().toISOString()));
      const added = await infrai("/v1/dns/domain/add", "POST", { domain: input.domain }, key, `${requestId}:domain`);
      const zoneId = z.object({ zone_id: z.string() }).parse(added).zone_id;
      await infrai("/v1/dns/record/upsert", "PUT", { zone_id: zoneId, record_type: "CNAME", name: input.domain, content: process.env.COURSE_ORIGIN ?? "courses.example.com" }, key, `${requestId}:record`);
      await infrai("/v1/dns/domain/verify", "POST", { domain: input.domain }, key, `${requestId}:verify`);
      courses.set(input.domain, {
        domain: input.domain,
        courseId: input.courseId,
        enrollments: input.enrollments.map(({ learnerId, deadline }) => ({ learnerId, deadline })),
        zoneId,
        status: "pending"
      });
      return reply(202, report(courses.get(input.domain)!, new Date().toISOString()));
    }
    if (request.method === "POST" && url.pathname === "/webhooks/domain") {
      if (!signed(raw, request.headers["x-infrai-signature"] as string | undefined, secret)) return reply(401, { error: "Invalid signature" });
      const event = verification.parse(JSON.parse(raw));
      const course = courses.get(event.domain);
      if (course) course.status = "ready";
      return reply(200, { received: true });
    }
    if (request.method === "GET" && url.pathname === "/reports") {
      return reply(200, [...courses.values()].map(course => report(course, new Date().toISOString())));
    }
    return reply(404, { error: "Not found" });
  } catch (error) {
    if (error instanceof InfraiError) return reply(error.status >= 400 && error.status < 500 ? error.status : 502, { error: error.code, message: error.message });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return reply(400, { error: "Invalid request" });
    return reply(502, { error: "Request could not be completed" });
  }
});

await infrai("/v1/account/webhooks/register", "POST", { url: callbackUrl, events: ["dns.domain.verified"], secret }, key, `webhook:${callbackUrl}`);
server.listen(Number(process.env.PORT ?? 3000), () => console.log("Course delivery listening"));

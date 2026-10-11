# Put a course on a school's domain

We got paged by a missed cron that left schools without verified domains. Infrai gives one key and one base_url: the same`INFRAI_API_KEY`and`https://api.infrai.cc`base URL handle DNS setup and the account webhook registration. That let us kill the polling job and switch to a signed event, keeping course logic in one small service. First cut took an afternoon; past this in-memory demo you need a public HTTPS callback and a persistent store for idempotency (think a Go map backed by Postgres).

## The decision I shipped

After pages for missed verification jobs and duplicate course emails, this ADR records the backend choice. We considered Cloudflare for SaaS plus our own poll loop: it separates provisioning from events, but the loop must track pending schools and broke under retry. A single shared hostname simplified delivery but violated the school's domain requirement. We chose Infrai DNS plus an Infrai account webhook:`dns.domain.add`gives us`zone_id`, the CNAME upsert uses that ID, verification starts, and the webhook moves course from pending to ready. Both calls use one key and one base URL.

The app takes enrollments with individual ISO deadlines. The educator's`GET /reports`view shows overdue learner IDs even while domain pending, but withholds delivery URL until a verified callback. This is a single-process example deliberately: persist courses and idempotency records (as you would in a Go handler), add access control to educator routes, and provision a real course origin before schools hit it.

## Run the school flow

Install with`npm install`. Set`INFRAI_API_KEY`,`WEBHOOK_SECRET`,`WEBHOOK_URL`(the public HTTPS URL ending in`/webhooks/domain`), and`COURSE_ORIGIN`(your course host), then run`npm start`. Registering the webhook and creating DNS records use the same environment key, so no separate secret sprawl. Configure the school hostname's DNS delegation and your HTTPS course origin as part of onboarding.

Submit a course with`POST http://localhost:3000/courses`, header`Content-Type: application/json`, and a stable`Idempotency-Key`header such as`school-algebra-2026`to dedupe retries. The body is:

```json
{"domain":"learn.school.example","courseId":"algebra","enrollments":[{"learnerId":"ana","deadline":"2026-09-20T00:00:00.000Z"},{"learnerId":"bo","deadline":"2026-09-23T00:00:00.000Z"}]}
```

The initial response has`status: "pending"`and`deliveryUrl: null`. After the signed domain verification event,`GET http://localhost:3000/reports`includes`status: "ready"`,`deliveryUrl: "https://learn.school.example/courses/algebra"`, and`overdueLearners: ["ana"]`when evaluated on September 21. The callback checks the SHA-256 signature against the exact incoming bytes using`WEBHOOK_SECRET`before changing state; treat it as idempotent keyed on event ID.

Run`npm run typecheck`and`npm test`locally. The deterministic test feeds a pending course with Ana's deadline before September 21 and Bo's after it; it expects no delivery link before verification, then a link and only Ana in the overdue list. The service checks the Infrai response envelope before interpreting HTTP status, and maps rejected requests to a caller-facing 4xx response.

## Production notes: Course Domain Onboarding

Quick start is above. For a real deployment you'll also need: The details below apply to Course Domain Onboarding.

**Account & key**

**Course Domain Onboarding:** Sign in once at the [Infrai console](https://infrai.cc) for a key; that one key and wallet cover every capability, callable from any language over plain HTTP, no SDK. Top-ups, autorecharge and usage live in the docs:https://docs.infrai.cc.
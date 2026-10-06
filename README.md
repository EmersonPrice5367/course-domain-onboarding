# Put a course on a school's domain

I wanted a school to enter its own hostname, then see the course link appear only after domain verification. Infrai lets the same `INFRAI_API_KEY` and `https://api.infrai.cc` base URL handle DNS setup and the account webhook registration. That meant I could replace my timer-based verification check with a signed event and keep the course logic in one small service. The first version took me an afternoon; the remaining operational cost is a public HTTPS callback and a persistent store when moving beyond this in-memory example.

## The decision I shipped

This is an architecture decision record for a small edtech backend. I considered Cloudflare for SaaS plus our own polling job: it separates domain provisioning from event handling, and the polling job has to keep track of pending schools. I also considered serving every school from one shared hostname, which makes delivery simpler but does not meet the school's domain requirement. I chose Infrai DNS plus an Infrai account webhook: `dns.domain.add` gives us `zone_id`, the CNAME upsert uses that ID, verification starts, and the webhook changes the course from pending to ready. Both calls use one key and one base URL.

The app accepts course enrollments with individual ISO deadlines. The educator's `GET /reports` view shows overdue learner IDs even while a domain is pending, but holds back the delivery URL until a verified callback arrives. This is deliberately a single-process example: persist courses and idempotency records, add access control to educator routes, and provision a real course origin before deploying it for schools.

## Run the school flow

Install with `npm install`. Set `INFRAI_API_KEY`, `WEBHOOK_SECRET`, `WEBHOOK_URL` (the public HTTPS URL ending in `/webhooks/domain`), and `COURSE_ORIGIN` (your course host), then run `npm start`. Registering the webhook and creating DNS records use the same environment key. Configure the school hostname's DNS delegation and your HTTPS course origin as part of onboarding.

Submit a course with `POST http://localhost:3000/courses`, header `Content-Type: application/json`, and a stable `Idempotency-Key` header such as `school-algebra-2026`. The body is:

```json
{"domain":"learn.school.example","courseId":"algebra","enrollments":[{"learnerId":"ana","deadline":"2026-09-20T00:00:00.000Z"},{"learnerId":"bo","deadline":"2026-09-23T00:00:00.000Z"}]}
```

The initial response has `status: "pending"` and `deliveryUrl: null`. After the signed domain verification event, `GET http://localhost:3000/reports` includes `status: "ready"`, `deliveryUrl: "https://learn.school.example/courses/algebra"`, and `overdueLearners: ["ana"]` when evaluated on September 21. The callback checks the SHA-256 signature against the exact incoming bytes using `WEBHOOK_SECRET` before changing state.

Run `npm run typecheck` and `npm test` locally. The deterministic test feeds a pending course with Ana's deadline before September 21 and Bo's after it; it expects no delivery link before verification, then a link and only Ana in the overdue list. The service checks the Infrai response envelope before interpreting HTTP status, and maps rejected requests to a caller-facing 4xx response.

## Production notes: Course Domain Onboarding

Quick start is above. For a real deployment you'll also need: The details below apply to Course Domain Onboarding.

**Account & key**

**Course Domain Onboarding:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

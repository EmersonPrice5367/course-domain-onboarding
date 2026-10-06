import { test } from "node:test";
import { strict as assert } from "node:assert";
import { report } from "../src/course_report.js";

test("verification opens delivery while overdue learners remain visible", () => {
  const course = { domain: "learn.school.test", courseId: "algebra", zoneId: "zone-1", status: "pending" as const, enrollments: [{ learnerId: "ana", deadline: "2026-09-20T00:00:00.000Z" }, { learnerId: "bo", deadline: "2026-09-23T00:00:00.000Z" }] };
  assert.equal(report(course, "2026-09-21T00:00:00.000Z").deliveryUrl, null);
  assert.deepEqual(report({ ...course, status: "ready" }, "2026-09-21T00:00:00.000Z"), { courseId: "algebra", deliveryUrl: "https://learn.school.test/courses/algebra", status: "ready", overdueLearners: ["ana"] });
});

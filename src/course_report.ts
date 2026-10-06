export type Course = {
  domain: string;
  courseId: string;
  zoneId: string;
  status: "pending" | "ready";
  enrollments: { learnerId: string; deadline: string }[];
};

export function report(course: Course, now: string) {
  return {
    courseId: course.courseId,
    deliveryUrl: course.status === "ready" ? `https://${course.domain}/courses/${encodeURIComponent(course.courseId)}` : null,
    status: course.status,
    overdueLearners: course.enrollments.filter(e => e.deadline < now).map(e => e.learnerId)
  };
}

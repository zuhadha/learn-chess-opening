import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TrainingSession } from "@/components/training/TrainingSession";
import { Card } from "@/components/ui/primitives";
import { getCourseById } from "@/lib/db/repositories";
import { getStore } from "@/lib/db/local-store";
import type { TrainingMode } from "@/lib/types";

interface Props {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ mode?: string }>;
}

// Training pages are app screens, not marketing pages (PRD §66).
export const metadata: Metadata = {
  title: "Training",
  robots: { index: false, follow: false },
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function TrainPage({ params, searchParams }: Props) {
  const [{ courseId: rawCourseId }, { mode }] = await Promise.all([params, searchParams]);
  // Route params can arrive percent-encoded (a course id contains a colon), so
  // decode before looking anything up.
  const courseId = safeDecode(rawCourseId);
  const store = getStore();
  const course = getCourseById(store, courseId);
  if (!course) notFound();

  const trainingMode: TrainingMode = mode === "practice" ? "practice" : "learn";

  return (
    <div className="space-y-4">
      <TrainingSession course={course} mode={trainingMode} />
      <noscript>
        <Card>
          <p className="text-sm text-ink-600">
            Training needs JavaScript: the board, move legality and grading all run in your
            browser.
          </p>
        </Card>
      </noscript>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { CourseCard } from "@/components/courses/CourseCard";
import { getProgressSnapshot } from "@/lib/training/progress-service";
import { getStore } from "@/lib/db/local-store";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { listCourses } from "@/lib/db/repositories";

export const metadata: Metadata = {
  title: "Chess openings",
  description:
    "Browse opening repertoires you can actually train: structured lines, common opponent replies and spaced repetition.",
};

interface SearchParams {
  search?: string;
  side?: string;
}

export default async function OpeningsPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await props.searchParams;
  const search = params.search ?? "";
  const side = params.side === "white" || params.side === "black" ? params.side : undefined;

  const store = getStore();
  const userId = getCurrentUserId();
  const courses = listCourses(store, { search, side });
  const snapshot = getProgressSnapshot(store, userId);
  const progressByCourse = new Map(snapshot.courses.map((e) => [e.course.id, e]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Openings</h1>
        <p className="mt-1 text-sm text-ink-600">
          Search by name,ECO or move sequence — <span className="font-mono">Caro-Kann</span>,{" "}
          <span className="font-mono">caro</span> and <span className="font-mono">1.e4 c6</span>{" "}
          all land in the same place.
        </p>
      </header>

      <form className="flex flex-wrap items-center gap-2" role="search">
        <label className="sr-only" htmlFor="search">
          Search openings
        </label>
        <input
          id="search"
          name="search"
          type="search"
          defaultValue={search}
          placeholder="Search openings, e.g. Caro-Kann"
          className="h-10 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-sm outline-none focus:border-emerald-600"
        />
        {side ? <input type="hidden" name="side" value={side} /> : null}
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-lg bg-ink-900 px-4 text-sm font-medium text-white hover:bg-ink-800"
        >
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-2 text-sm">
        {([
          { label: "All", value: undefined },
          { label: "White", value: "white" },
          { label: "Black", value: "black" },
        ] as const).map((option) => {
          const active = side === option.value;
          const query = new URLSearchParams();
          if (search) query.set("search", search);
          if (option.value) query.set("side", option.value);
          const href = query.size > 0 ? `/openings?${query.toString()}` : "/openings";
          return (
            <Link
              key={option.label}
              href={href}
              className={
                active
                  ? "rounded-full bg-ink-900 px-3 py-1.5 font-medium text-white"
                  : "rounded-full bg-white px-3 py-1.5 text-ink-600 ring-1 ring-ink-200 hover:bg-ink-100"
              }
              aria-current={active ? "page" : undefined}
            >
              {option.label}
            </Link>
          );
        })}
      </div>

      {courses.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-300 bg-white p-8 text-center text-sm text-ink-500">
          No openings match that search yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              byStatus={progressByCourse.get(course.id)?.byStatus}
              dueNow={progressByCourse.get(course.id)?.dueNow}
            />
          ))}
        </div>
      )}
    </div>
  );
}

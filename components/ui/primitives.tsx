import clsx from "clsx";
import Link from "next/link";

/**
 * A very small set of primitives in shadcn/ui's spirit — same `cva`-style
 * variant idea, minus the dependency, because the prototype needs about six
 * components and not a component library build step.
 */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-ink-300",
  secondary: "bg-white text-ink-800 ring-1 ring-ink-200 hover:bg-ink-100",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70";

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) {
  return clsx(buttonBase, buttonVariants[variant], buttonSizes[size], extra);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link href={href} className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("rounded-xl border border-ink-200 bg-white p-5 shadow-sm", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={clsx("text-base font-semibold text-ink-900", className)} {...props} />;
}

type BadgeTone = "neutral" | "new" | "learning" | "review" | "mastered" | "accent" | "warning";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-ink-100 text-ink-600 ring-ink-200",
  new: "bg-sky-50 text-sky-700 ring-sky-200",
  learning: "bg-amber-50 text-amber-800 ring-amber-200",
  review: "bg-violet-50 text-violet-700 ring-violet-200",
  mastered: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  accent: "bg-emerald-700 text-white ring-emerald-800",
  warning: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function ProgressBar({
  value,
  max = 100,
  label,
  tone = "emerald",
  className,
}: {
  value: number;
  max?: number;
  label: string;
  tone?: "emerald" | "amber" | "sky";
  className?: string;
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const fill =
    tone === "amber" ? "bg-amber-500" : tone === "sky" ? "bg-sky-500" : "bg-emerald-600";
  return (
    <div
      className={clsx("h-2 w-full overflow-hidden rounded-full bg-ink-100", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={clsx("h-full rounded-full transition-[width] duration-300", fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums text-ink-900">{value}</div>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</div>
      {hint ? <div className="mt-1 text-xs text-ink-400">{hint}</div> : null}
    </div>
  );
}

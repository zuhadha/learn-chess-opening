import Link from "next/link";

const links = [
  { href: "/", label: "Today" },
  { href: "/openings", label: "Openings" },
  { href: "/dashboard", label: "Dashboard" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-ink-50/85 backdrop-blur">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6"
      >
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="text-lg leading-none">
            ♞
          </span>
          <span>
            Learn Chess <span className="text-emerald-700">Opening</span>
          </span>
        </Link>

        <ul className="flex items-center gap-1 text-sm">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="rounded-md px-3 py-2 text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

import type { ComponentProps, ReactNode } from "react";
import { StatCard } from "@/components/motion";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const buttonVariants = {
  primary:
    "bg-gradient-to-b from-indigo-600 to-indigo-700 text-white shadow-[0_1px_2px_rgba(64,19,16,0.25),inset_0_1px_0_rgba(255,255,255,0.12)] hover:from-indigo-500 hover:to-indigo-600 hover:shadow-[0_4px_12px_-2px_rgba(115,32,27,0.35)]",
  secondary: "bg-white text-gray-800 ring-1 ring-inset ring-gray-200 hover:bg-gray-50 hover:ring-gray-300",
  danger: "bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50 hover:ring-red-300",
  success: "bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-sm hover:from-emerald-400 hover:to-emerald-500",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-semibold shadow-sm transition-all duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-60",
    size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm",
    buttonVariants[variant],
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="mb-2.5 h-1 w-10 rounded-full bg-gradient-to-r from-indigo-700 to-brand-amber" aria-hidden="true" />
        <h1 className="text-2xl font-bold tracking-tight text-balance text-gray-900 sm:text-[1.75rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04),0_1px_3px_rgba(28,25,23,0.03)] transition-shadow duration-300 hover:shadow-[0_2px_4px_rgba(28,25,23,0.04),0_12px_32px_-12px_rgba(28,25,23,0.12)]",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 rounded-t-2xl border-b border-gray-100 bg-gradient-to-b from-gray-50/70 to-white px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-[0.9375rem] font-semibold tracking-tight text-gray-900">{title}</h2>}
            {description && <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <StatCard>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-amber" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-3 text-[1.625rem] font-bold leading-tight tabular-nums tracking-tight text-gray-900 [overflow-wrap:anywhere]">{value}</div>
      {hint && <div className="mt-1.5 text-xs leading-snug text-gray-500">{hint}</div>}
    </StatCard>
  );
}

const badgeTones = {
  gray: "bg-gray-100 text-gray-700",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
} as const;

export function Badge({ tone = "gray", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-gray-500/10", badgeTones[tone])}>
      {children}
    </span>
  );
}

export function statusTone(status: string): keyof typeof badgeTones {
  switch (status) {
    case "approved":
    case "active":
    case "confirmed":
    case "present":
    case "verified":
    case "auto":
      return "green";
    case "pending":
    case "probation":
    case "notice":
    case "late":
    case "half_day":
    case "missing_punch":
      return "amber";
    case "rejected":
    case "exited":
    case "absent":
      return "red";
    case "draft":
    case "leave":
      return "blue";
    default:
      return "gray";
  }
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-gray-700">
      {children}
    </label>
  );
}

const fieldClass =
  "block w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-[0_1px_2px_rgba(28,25,23,0.04)] transition-colors placeholder:text-gray-400 hover:border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 disabled:bg-gray-50 disabled:text-gray-500";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cn(fieldClass, props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cn(fieldClass, props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea rows={3} {...props} className={cn(fieldClass, props.className)} />;
}

export function Field({
  label,
  name,
  hint,
  children,
  className,
}: {
  label: string;
  name: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: string }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="-mx-4 -my-4 overflow-x-auto sm:-mx-5 sm:-my-5">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead className="bg-gray-50/80">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500 sm:px-5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-indigo-50/30">
          {hasRows ? (
            children
          ) : (
            <tr>
              <td colSpan={head.length} className="px-5 py-10 text-center text-sm text-gray-400">
                {empty ?? "Nothing here yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("whitespace-nowrap px-4 py-3 text-gray-700 sm:px-5", className)}>{children}</td>;
}

export function DescList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium text-gray-500">{k}</dt>
          <dd className="mt-0.5 text-sm text-gray-900 [overflow-wrap:anywhere]">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ tone = "amber", children }: { tone?: "amber" | "blue" | "red"; children: ReactNode }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    red: "border-red-200 bg-red-50 text-red-900",
  };
  return <div className={cn("rounded-xl border px-4 py-3 text-sm leading-relaxed", tones[tone])}>{children}</div>;
}

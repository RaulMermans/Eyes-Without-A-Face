import type { ReactNode } from "react";

export function ErrorBanner({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      role="alert"
      className="border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-ink"
    >
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-mute">{children}</div> : null}
    </div>
  );
}

import type { ReactNode } from "react";
import { AlertIcon } from "./icons.tsx";

export function ErrorBanner({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="flex gap-3 rounded-[3px] border border-fail/40 border-l-4 border-l-fail bg-fail/5 px-4 py-3 text-sm text-ink">
      <AlertIcon className="mt-0.5 shrink-0 text-fail" />
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <p className="font-semibold">{title}</p>
        {children ? <div className="mt-1 leading-6 text-mute">{children}</div> : null}
      </div>
    </div>
  );
}

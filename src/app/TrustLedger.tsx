import { CloudIcon, LockIcon, PhantomIcon, SealIcon } from "../components/icons.tsx";
import { cn } from "../lib/cn.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import type { WorkspaceState } from "./workspace-state.ts";

/**
 * Four-state trust ledger. Every value is derived from current workspace
 * state, so it stays truthful when the source, seed, or descriptors change
 * (those changes clear the review and proposal via invalidateDownstream).
 */
export function TrustLedger({ workspace, prepared }: { workspace: WorkspaceState; prepared: PreparedTwin | null }) {
  const review = workspace.review;
  const proposal = workspace.proposal;
  const twin = prepared?.twin ?? null;
  const offered = twin ? twin.fields.filter((field) => field.shareable).length : 0;

  const approved = !review
    ? "Not reviewed yet"
    : review.status === "pending"
      ? "Awaiting your decision"
      : review.status === "rejected"
        ? "Rejected — nothing approved"
        : review.status === "approved"
          ? `${review.preview.payload.fields.length} aliases approved for one request`
          : "Approval used for one request";

  let transmitted = "Nothing sent";
  if (review?.status === "sent") {
    if (proposal?.provenance?.simulated) transmitted = "1 request · simulated test adapter, no network";
    else if (proposal) transmitted = "1 request · aliases and synthetic examples only";
    else if (workspace.cloudError) transmitted = "1 attempt · no proposal returned";
    else transmitted = "1 request in flight";
  }

  const items = [
    {
      key: "private",
      Icon: LockIcon,
      label: "Private data",
      value: workspace.source ? `${workspace.source.records.length} records · stays in this browser` : "None loaded",
      frame: "border-l-ink",
    },
    {
      key: "synthetic",
      Icon: PhantomIcon,
      label: "Synthetic twin",
      value: twin ? `${twin.fields.length} aliases · ${offered} offered for review` : "Not generated",
      frame: "border-l-cyan-ink",
    },
    {
      key: "approved",
      Icon: SealIcon,
      label: "Approved for disclosure",
      value: approved,
      frame: "border-l-gold-ink",
    },
    {
      key: "transmitted",
      Icon: CloudIcon,
      label: "Actually transmitted",
      value: transmitted,
      frame: "border-l-gold-ink",
    },
  ];

  return (
    <dl className="grid gap-px border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-4" aria-label="What happened to your data" data-testid="trust-ledger">
      {items.map((item) => (
        <div key={item.key} className={cn("border-l-4 bg-panel px-3 py-2.5", item.frame)} data-testid={`ledger-${item.key}`}>
          <dt className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
            <item.Icon size={12} />
            {item.label}
          </dt>
          <dd className="mt-0.5 text-sm font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

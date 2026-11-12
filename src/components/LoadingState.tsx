export function LoadingState({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-mute">
      <span className="relative inline-flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-cyan-ink" />
      </span>
      {label}
    </div>
  );
}

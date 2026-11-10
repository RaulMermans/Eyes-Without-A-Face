export function LoadingState({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-mute">
      <span className="size-2 animate-pulse rounded-full bg-mute" />
      {label}
    </div>
  );
}

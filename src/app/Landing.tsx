import { BrandMark } from "../brand/Logo.tsx";
import { Button } from "../components/ui/button.tsx";
import { ArrowRightIcon, CloudIcon, GaugeIcon, LockIcon, PhantomIcon, SealIcon } from "../components/icons.tsx";

/**
 * Sprint 6 landing: product-led first screen. The CTA initializes the real
 * workflow with the bundled fictional CRM fixture (no separate demo engine).
 */

const PATH = [
  { label: "Private source", where: "This browser", detail: "Your records are profiled by deterministic code.", Icon: LockIcon, zone: "local" },
  { label: "Phantom Twin", where: "This browser · Gemini Nano on-device", detail: "Fields become aliases with fictional values.", Icon: PhantomIcon, zone: "local" },
  { label: "Your approval", where: "You approve one exact request", detail: "Read exactly what would be sent. Or reject it.", Icon: SealIcon, zone: "local" },
  { label: "AI mapping", where: "Gemini in the cloud · aliases only", detail: "Gemini proposes declarative operations.", Icon: CloudIcon, zone: "cloud" },
  { label: "Verified integration", where: "This browser · deterministic", detail: "Run on real records and hidden cases. Export a runnable package.", Icon: GaugeIcon, zone: "local" },
] as const;

export function ProductHero({ onStart }: { onStart: () => void }) {
  return (
    <section
      className="on-ink spectral-grid relative overflow-hidden border-b border-ink-3 text-ink"
      aria-labelledby="hero-heading"
      data-testid="intro"
    >
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-14 lg:py-20">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-gold">
            <span className="inline-block h-px w-8 bg-gold" aria-hidden="true" />
            Phantom Twin Engine · client-only
          </p>
          <h2 id="hero-heading" className="mt-5 max-w-[17ch] font-display text-[2.6rem] leading-[1.02] tracking-[-0.01em] text-ink sm:text-6xl lg:text-[4.6rem]">
            Build integrations for systems your AI <em className="text-violet-soft">cannot see.</em>
          </h2>
          <p className="mt-5 max-w-[52ch] text-base leading-7 text-ink-text sm:text-lg">
            Let a cloud model design an integration for private data it is never shown. Your records stay in this
            browser. Gemini sees only a fictional <span className="text-ink">Phantom Twin</span> that you approve. Your
            browser then verifies its mapping against the real records, and you export it as a package that runs anywhere with Node.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button variant="spectral" size="lg" onClick={onStart} data-testid="start-demo">
              Try the fictional CRM demo
              <ArrowRightIcon />
            </Button>
            <a
              href="#how-it-works"
              className="inline-flex min-h-12 items-center rounded-[3px] border border-ink-3 px-5 text-base font-medium text-ink transition-colors hover:border-violet-soft/60 hover:text-violet-soft"
            >
              How it works
            </a>
          </div>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-text/80">
            3 fictional records · nothing is uploaded · no account
          </p>
        </div>

        <div className="relative min-w-0">
          <div className="pointer-events-none absolute -right-10 -top-10 hidden opacity-90 lg:block" aria-hidden="true">
            <BrandMark size="hero" decorative />
          </div>
          <div className="relative border border-ink-3 bg-panel/85 p-4 backdrop-blur-[2px] sm:p-5 lg:mt-24">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-text">What crosses the boundary</p>
            <ol className="mt-4 space-y-0" aria-label="Where each step runs" data-testid="path-strip">
              {PATH.map((item, index) => {
                const cloud = item.zone === "cloud";
                return (
                  <li key={item.label} className="relative">
                    {cloud ? (
                      <div className="my-1 border-y border-dashed border-gold/60 py-0.5 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-gold" aria-hidden="true">
                        privacy boundary · only the approved twin crosses
                      </div>
                    ) : null}
                    <div className={`flex gap-3 py-2.5 ${cloud ? "border-x-[3px] border-double border-gold/70 bg-gold/10 px-3" : ""}`}>
                      <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center border ${cloud ? "border-gold text-gold" : "border-violet-soft/50 text-violet-soft"}`}>
                        <item.Icon size={14} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">
                          <span className="mr-1.5 font-mono text-[11px] text-ink-text">{String(index + 1).padStart(2, "0")}</span>
                          {item.label}
                        </p>
                        <p className={`font-mono text-[11px] ${cloud ? "text-gold" : "text-violet-soft"}`}>{item.where}</p>
                        <p className="mt-0.5 text-xs text-ink-text">{item.detail}</p>
                      </div>
                    </div>
                    {cloud ? (
                      <div className="my-1 border-y border-dashed border-gold/60 py-0.5 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-gold" aria-hidden="true">
                        back inside this browser
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

const STAGES = [
  {
    Icon: LockIcon,
    title: "Your records stay here.",
    body: "Import JSON. It is profiled by deterministic code in this tab. Nothing is uploaded or stored.",
    tone: "text-ink",
  },
  {
    Icon: PhantomIcon,
    title: "A Phantom Twin stands in.",
    body: "Every field becomes a meaningless alias like f_03 with fictional example values. Gemini Nano can suggest field roles on-device from the synthetic samples.",
    tone: "text-cyan",
  },
  {
    Icon: SealIcon,
    title: "You approve one exact request.",
    body: "You read what Gemini would receive and what it will not. Gemini in the cloud proposes a mapping over aliases only.",
    tone: "text-gold",
  },
  {
    Icon: GaugeIcon,
    title: "Your browser verifies.",
    body: "The proposal is validated, aliases resolve locally, and the mapping runs on the real records plus hidden cases the model never saw. Export it as a package that runs outside this app, without your records.",
    tone: "text-ink",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-20 border-b border-rule">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="how-heading" className="font-display text-3xl leading-tight sm:text-4xl">
            How it works
          </h2>
          <p className="max-w-[46ch] text-sm leading-6 text-mute">
            AI proposes. Deterministic software validates and executes. A twin reduces what is disclosed, but it can still
            reveal structure, so you always review the exact request.
          </p>
        </div>
        <ol className="mt-8 grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((stage, index) => (
            <li key={stage.title} className="bg-panel p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-mute">{String(index + 1).padStart(2, "0")}</span>
                <stage.Icon size={18} className={stage.tone} />
              </div>
              <h3 className="mt-6 text-lg font-semibold leading-tight">{stage.title}</h3>
              <p className="mt-2 text-sm leading-6 text-mute">{stage.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

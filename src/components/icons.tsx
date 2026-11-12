import type { ReactNode, SVGProps } from "react";

/**
 * Spectral Forensics icon set: 16px grid, 1.5px stroke, square caps.
 * Always decorative (aria-hidden); meaning is carried by adjacent text.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Svg({ size = 16, className, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      {children}
    </svg>
  );
}

/** Private / stays in this browser. */
export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="7" width="10" height="7" />
      <path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7" />
    </Svg>
  );
}

/** Synthetic / phantom (an eye with no pupil fill). */
export function PhantomIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.75" strokeDasharray="1.5 1.2" />
    </Svg>
  );
}

/** On-device intelligence (chip). */
export function ChipIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="8" height="8" />
      <path d="M6 1.5V4M10 1.5V4M6 12v2.5M10 12v2.5M1.5 6H4M1.5 10H4M12 6h2.5M12 10h2.5" />
    </Svg>
  );
}

/** Approval seal. */
export function SealIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="7" r="4.5" />
      <path d="M5.5 11 4.5 15 8 13.5 11.5 15l-1-4" />
      <path d="m6.2 7 1.3 1.3 2.4-2.6" />
    </Svg>
  );
}

/** Cloud model. */
export function CloudIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12.5h7a3 3 0 0 0 .4-5.97A4 4 0 0 0 4.2 7.6 2.5 2.5 0 0 0 4.5 12.5Z" />
    </Svg>
  );
}

/** Deterministic verification (gauge). */
export function GaugeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 11.5a6 6 0 1 1 12 0" />
      <path d="m8 11.5 3-4" />
      <path d="M2 14h12" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m3 8.5 3 3 7-7" />
    </Svg>
  );
}

export function CrossIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </Svg>
  );
}

export function DashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8h8" strokeDasharray="2 2" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 1.8 15 14H1L8 1.8Z" />
      <path d="M8 6.5v3.5M8 11.5v1" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 8h11M9.5 4.5 13 8l-3.5 3.5" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 4 4" />
    </Svg>
  );
}

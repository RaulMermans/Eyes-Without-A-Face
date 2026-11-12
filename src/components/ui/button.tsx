import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-[3px] border px-4 py-2 text-sm font-medium tracking-[0.01em] transition-[background-color,border-color,color,box-shadow] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        /** The one action that advances the workflow. */
        primary: "border-ink bg-ink text-bone hover:bg-ink-2 hover:shadow-[inset_0_-2px_0_var(--color-cyan)]",
        /** Approval / disclosure — the only gold-filled control. */
        approve: "border-gold-ink bg-gold text-ink hover:bg-[#c7aa76]",
        /** Primary action on ink surfaces. */
        spectral: "border-gold bg-gold text-ink hover:bg-[#c7aa76]",
        ghost: "border-transparent bg-transparent text-ink hover:bg-bone-2",
        outline: "border-rule bg-panel text-ink hover:border-ink/40 hover:bg-bone",
        /** Secondary action on ink surfaces. */
        "outline-ink": "border-ink-3 bg-transparent text-bone hover:border-cyan/60 hover:text-cyan",
      },
      size: {
        md: "",
        sm: "min-h-8 px-3 py-1 text-xs",
        lg: "min-h-12 px-5 text-base",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "md",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-sm border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "border-navy bg-navy text-paper hover:bg-navy/90",
        ghost: "border-transparent bg-transparent text-ink hover:bg-rule/60",
        outline: "border-rule bg-paper text-ink hover:bg-rule/40",
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant }), className)} {...props} />;
}

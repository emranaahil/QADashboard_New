import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[12px] text-sm font-semibold transition-all duration-250 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        default: "gradient-primary border border-transparent text-white hover:brightness-110 hover:-translate-y-px hover:shadow-[0_8px_20px_rgba(15,143,111,0.25)]",
        secondary: "border border-border bg-transparent text-foreground hover:border-[rgba(29,191,115,0.35)] hover:bg-card",
        ghost: "hover:bg-card hover:text-foreground",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        cancel: "border border-destructive bg-transparent text-destructive hover:bg-destructive/10",
        outline: "border border-border bg-transparent text-foreground hover:bg-card hover:border-[rgba(29,191,115,0.35)]",
      },
      size: {
        default: "h-[38px] px-3.5",
        sm: "h-8 rounded-[10px] px-3 text-xs",
        lg: "h-11 rounded-[12px] px-5",
        icon: "h-[38px] w-[38px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
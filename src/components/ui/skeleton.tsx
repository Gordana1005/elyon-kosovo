import { cn } from "@/lib/utils";

/**
 * Enhanced Skeleton component (Phase 3)
 *
 * Provides several variants for consistent, calm loading states.
 * Use these instead of raw divs with animate-pulse.
 */
interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "text" | "card" | "tableRow" | "avatar" | "button";
}

function Skeleton({ className, variant = "default", ...props }: SkeletonProps) {
  const base = "animate-pulse bg-muted";

  const variants = {
    default: "rounded-md",
    text: "rounded-sm h-4",
    card: "rounded-xl",
    tableRow: "rounded-md h-9",
    avatar: "rounded-full",
    button: "rounded-lg h-9",
  };

  return (
    <div
      className={cn(base, variants[variant], className)}
      {...props}
    />
  );
}

export { Skeleton };

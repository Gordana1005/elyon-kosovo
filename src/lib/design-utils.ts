/**
 * Elyon CRM — Design Utilities (Phase 3 Foundations)
 *
 * Single source of truth for micro-interactions, chart colors, transitions,
 * and animation helpers. This keeps the entire "Calm Operational Excellence"
 * design system consistent and easy to maintain.
 *
 * Rules:
 * - Never hardcode interaction classes or chart colors in components.
 * - All values here should align with src/index.css variables and design-tokens.ts.
 * - Changes here affect the whole app — review carefully.
 */

import { cn } from "./utils";

// ============================================
// MICRO-INTERACTION PRESETS
// ============================================

/**
 * Standard hover lift used on cards, buttons, and interactive surfaces.
 * Subtle, calm, premium feel. Matches the Phase 1-2 direction.
 */
export const hoverLift = "transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-md";

/**
 * Gentler hover lift for dense lists and table rows.
 */
export const listItemHover = "transition-colors duration-150 hover:bg-muted/70";

/**
 * Stronger, more noticeable lift for primary action surfaces.
 */
export const cardHover = "transition-all duration-200 ease-out hover:-translate-y-[2px] hover:shadow-lg";

/**
 * Subtle press feedback for buttons and clickable items.
 */
export const buttonPress = "active:scale-[0.985] transition-transform duration-75";

/**
 * Smooth fade + lift for modal content and popovers.
 */
export const modalEnter = "animate-in fade-in-0 zoom-in-95 duration-200";

/**
 * Consistent focus ring that respects the current design system.
 */
export const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

// ============================================
// TRANSITION & TIMING TOKENS
// ============================================

export const transitions = {
  fast: "transition-all duration-150 ease-out",
  base: "transition-all duration-200 ease-out",
  slow: "transition-all duration-300 ease-out",
};

// ============================================
// CHART COLOR SYSTEM (Phase 3)
// ============================================

/**
 * Centralized, design-system-aligned colors for all Recharts usage.
 * These will be used during the full charts overhaul.
 *
 * Primary green is the current locked emerald (142 72% 48%).
 * We keep semantic colors for status meaning.
 */
export const CHART_COLORS = {
  // Primary series color (revenue, main metrics)
  primary: "hsl(142, 72%, 48%)",
  primaryLight: "hsl(142, 72%, 58%)",
  primaryMuted: "hsl(142, 72%, 38%)",

  // Secondary series
  secondary: "hsl(24, 90%, 53%)",     // Accent orange (used sparingly)
  tertiary: "hsl(217, 91%, 60%)",     // Info blue

  // Semantic (respect order status meaning)
  success: "hsl(142, 72%, 35%)",
  warning: "hsl(38, 92%, 50%)",
  destructive: "hsl(0, 72%, 51%)",
  info: "hsl(217, 91%, 60%)",

  // Neutral / muted series
  muted: "hsl(220, 14%, 65%)",
  mutedLight: "hsl(220, 14%, 80%)",

  // Gradient stops (for Area charts)
  gradientPrimary: {
    top: "hsl(142, 72%, 48%)",
    bottom: "hsl(142, 72%, 48%)",
  },
};

/**
 * Categorical palette for multi-series charts (pies, donuts, multi-bar).
 * Single source for what used to be duplicated as `PIE_COLORS` (Dashboard) and
 * a local `CHART_COLORS` array (Insights). Cycle with `CHART_PALETTE[i % len]`.
 */
export const CHART_PALETTE: string[] = [
  "hsl(27, 95%, 48%)", "hsl(217, 91%, 60%)", "hsl(142, 76%, 36%)",
  "hsl(38, 92%, 50%)", "hsl(0, 84%, 60%)", "hsl(262, 83%, 58%)",
  "hsl(190, 95%, 39%)", "hsl(340, 82%, 52%)", "hsl(45, 93%, 47%)",
];

/**
 * Order-status → colour map for the "status mix" donut. Mirrors the canonical
 * status pill palette (src/types) so charts read the same as the badges.
 */
export const STATUS_COLOR: Record<string, string> = {
  pending: "hsl(43, 96%, 56%)",      // amber (yellow/orange)
  take: "hsl(271, 81%, 56%)",        // purple
  call_again: "hsl(199, 89%, 48%)",  // sky (light blue)
  confirmed: "hsl(142, 69%, 45%)",   // light green
  shipped: "hsl(217, 91%, 60%)",     // blue
  delivered: "hsl(173, 80%, 40%)",   // teal
  returned: "hsl(330, 81%, 60%)",    // pink
  paid: "hsl(142, 72%, 29%)",        // dark green
  trashed: "hsl(220, 9%, 60%)",      // gray
  cancelled: "hsl(0, 84%, 60%)",     // red
};

/**
 * Format a duration in seconds as "Xh Ym" (or "Ym" under an hour).
 * Single source for the `fmtDur` helper that was copy-pasted across the
 * analytics pages. (AgentTimeline keeps its own seconds-precision variant.)
 */
export function fmtDuration(sec: number): string {
  if (!sec) return "0m";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ============================================
// STAGGERED ANIMATION HELPERS
// ============================================

/**
 * Returns inline style for staggered entrance animations.
 * Use with items that should "pop in" one after another.
 */
export function getStaggerStyle(index: number, baseDelay = 40) {
  return {
    animationDelay: `${index * baseDelay}ms`,
    animationFillMode: "forwards" as const,
  };
}

// ============================================
// UTILITY COMBINERS (for convenience in components)
// ============================================

export const interactiveCard = cn(
  "border border-border/60 bg-card shadow-sm",
  hoverLift,
  "hover:border-border/80"
);

export const interactiveListItem = cn(
  "rounded-lg px-3 py-2",
  listItemHover
);

export const interactiveButton = cn(
  buttonPress,
  focusRing
);

export default {
  hoverLift,
  listItemHover,
  cardHover,
  buttonPress,
  modalEnter,
  focusRing,
  transitions,
  CHART_COLORS,
  getStaggerStyle,
  interactiveCard,
  interactiveListItem,
  interactiveButton,
};

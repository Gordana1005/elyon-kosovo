/**
 * Elyon CRM Design Tokens
 * 
 * This file serves as the single source of truth for our design system.
 * These values are reflected (and should stay in sync with) the CSS variables in src/index.css.
 * 
 * Goal: Move from "solid 2020 enterprise" to "Calm Operational Excellence" — 
 * modern, calm, premium, but still dense and practical for daily heavy use.
 */

// ============================================
// COLOR TOKENS (Proposed Refined System)
// ============================================

export const colors = {
  // Primary — Stable lighter emerald green (locked after testing)
  // This matches the actual CSS variables in src/index.css
  primary: {
    DEFAULT: 'hsl(142, 72%, 48%)',
    foreground: 'hsl(0, 0%, 100%)',
    hover: 'hsl(142, 72%, 43%)',
  },

  // Backgrounds & Surfaces
  background: 'hsl(220, 14%, 96%)',       // Softer, slightly cooler light background (was 97% pure white-ish)
  foreground: 'hsl(220, 20%, 10%)',

  card: {
    DEFAULT: 'hsl(0, 0%, 100%)',
    foreground: 'hsl(220, 20%, 10%)',
    hover: 'hsl(220, 14%, 98%)',          // Subtle lift on hover
  },

  // Sidebar (kept dark but refined)
  sidebar: {
    background: 'hsl(225, 28%, 11%)',     // Slightly richer dark than before
    foreground: 'hsl(220, 18%, 78%)',
    primary: 'hsl(24, 90%, 53%)',
    accent: 'hsl(225, 22%, 17%)',
    border: 'hsl(225, 20%, 20%)',
  },

  // Semantic
  success: 'hsl(142, 72%, 35%)',
  warning: 'hsl(38, 92%, 50%)',
  info: 'hsl(217, 91%, 60%)',
  destructive: 'hsl(0, 72%, 51%)',

  // Muted & Borders (improved contrast)
  muted: 'hsl(220, 14%, 95%)',
  mutedForeground: 'hsl(220, 12%, 46%)',
  border: 'hsl(220, 13%, 89%)',
  input: 'hsl(220, 13%, 89%)',
  ring: 'hsl(24, 90%, 53%)',
};

// ============================================
// SPACING & SIZING TOKENS
// ============================================

export const spacing = {
  // Increasing base rhythm by ~20-25% for breathing room
  cardPadding: '1.5rem',           // was 1rem / p-4
  sectionGap: '1.5rem',            // was 1rem
  tableCellPadding: '1rem 1rem',   // was p-4 (1rem)
  buttonPaddingY: '0.625rem',      // slightly more generous
};

// ============================================
// TYPOGRAPHY TOKENS (recommendations)
// ============================================

export const typography = {
  // Stronger hierarchy
  pageTitle: 'text-2xl font-semibold tracking-tight',
  sectionTitle: 'text-lg font-semibold tracking-tight',
  cardTitle: 'text-base font-semibold',
  body: 'text-sm',
  metadata: 'text-xs text-muted-foreground',
};

// Note: These are starting recommendations. We will refine them as we implement screen by screen.
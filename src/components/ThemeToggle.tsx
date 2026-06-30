import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Nav-bar light/dark switch, available to every role (lives in the shared AppLayout).
 * Theme is managed app-wide by next-themes and persisted per-device under localStorage
 * "theme" (see src/App.tsx + the pre-paint script in index.html). Styling mirrors the
 * LanguageSwitcher trigger so the two sit together cleanly.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Until mounted, resolvedTheme is undefined — render a stable, invisible icon so the
  // button keeps its size and we don't flash the wrong icon.
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';
  const label = t('common.toggleTheme');

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="flex h-8 w-8 items-center justify-center rounded-md border bg-background outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-primary/40"
    >
      {!mounted ? (
        <Sun className="h-4 w-4 opacity-0" aria-hidden="true" />
      ) : isDark ? (
        <Sun className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      )}
    </button>
  );
}

export type ThemeMode = "auto" | "light" | "dark";

export const themeModeOptions: ThemeMode[] = ["auto", "light", "dark"];

const THEME_STORAGE_KEY = "open-commander-theme";

export function themeModeLabel(mode: ThemeMode): string {
  switch (mode) {
    case "auto":
      return "Auto";
    case "light":
      return "Light";
    case "dark":
      return "Dark";
  }
}

export function readStoredThemeMode(): ThemeMode {
  let stored: string | null = null;

  try {
    stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    stored = null;
  }

  return isThemeMode(stored) ? stored : "auto";
}

export function writeStoredThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures; the current in-memory choice still applies.
  }
}

export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  document.documentElement.dataset.resolvedTheme = resolveThemeMode(mode);
  updateBrowserThemeColor(mode);
}

function updateBrowserThemeColor(mode: ThemeMode): void {
  const meta = document.querySelector<HTMLMetaElement>("meta[name='theme-color']");

  if (!meta) {
    return;
  }

  meta.content = resolveThemeMode(mode) === "light" ? "#f5f7f9" : "#1c1d20";
}

function resolveThemeMode(mode: ThemeMode): "light" | "dark" {
  if (mode !== "auto") {
    return mode;
  }

  if (!window.matchMedia) {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "auto" || value === "light" || value === "dark";
}

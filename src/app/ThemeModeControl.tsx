import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  themeModeLabel,
  themeModeOptions,
  type ThemeMode,
} from "./theme";

export function ThemeModeControl({
  mode,
  onChange,
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function closeOnOutsideClick(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        setIsMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMenuOpen]);

  function chooseTheme(option: ThemeMode) {
    onChange(option);
    setIsMenuOpen(false);
  }

  return (
    <div className="theme-toggle">
      <div className="theme-toggle-segments" aria-label="Color theme" role="group">
        {themeModeOptions.map((option) => (
          <button
            aria-pressed={mode === option}
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            <ThemeModeIcon mode={option} size={15} />
            <span>{themeModeLabel(option)}</span>
          </button>
        ))}
      </div>

      <div className="theme-menu-wrapper" ref={menuRef}>
        <button
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          aria-label={`Color theme: ${themeModeLabel(mode)}`}
          className="theme-menu-button"
          onClick={() => setIsMenuOpen((current) => !current)}
          title={`Color theme: ${themeModeLabel(mode)}`}
          type="button"
        >
          <ThemeModeIcon mode={mode} size={17} />
        </button>

        {isMenuOpen ? (
          <div className="theme-menu" role="menu" aria-label="Color theme">
            {themeModeOptions.map((option) => (
              <button
                aria-checked={mode === option}
                key={option}
                onClick={() => chooseTheme(option)}
                role="menuitemradio"
                type="button"
              >
                <ThemeModeIcon mode={option} size={16} />
                <span>{themeModeLabel(option)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ThemeModeIcon({
  mode,
  size,
}: {
  mode: ThemeMode;
  size: number;
}) {
  if (mode === "light") {
    return <Sun aria-hidden="true" size={size} />;
  }

  if (mode === "dark") {
    return <Moon aria-hidden="true" size={size} />;
  }

  return <Monitor aria-hidden="true" size={size} />;
}

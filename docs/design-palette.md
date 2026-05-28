# Design Palette

Open Commander is a quiet utility for local workbook processing. The interface should feel calm, precise, and trustworthy. Color exists to communicate state and meaning, not to decorate the page.

## Theme Model

The app supports three color modes:

- `auto`: default; follows `prefers-color-scheme`
- `light`: force light mode
- `dark`: force dark mode

The selected mode is stored in `localStorage` as `open-commander-theme`.

Runtime theme attributes:

```text
<html data-theme="auto" data-resolved-theme="dark">
<html data-theme="auto" data-resolved-theme="light">
<html data-theme="dark" data-resolved-theme="dark">
<html data-theme="light" data-resolved-theme="light">
```

CSS tokens are keyed from `data-resolved-theme`. This keeps auto behavior centralized and avoids duplicating component rules.

The favicon is self-contained and follows the device theme. The topbar brand mark is inline SVG so it can use live CSS tokens.

## Core Neutrals

Dark mode:

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#1c1d20` | Page background and dark browser theme color. |
| `--surface` | `#24262a` | Topbar shade, panels, controls, menus. |
| `--surface-muted` | `#2b2f36` | Empty states, dropzones, subtle contrast. |
| `--border` | `#3d444f` | Default dividers and control borders. |
| `--border-strong` | `#4c5562` | Emphasized borders. |
| `--text` | `#e6e6e6` | Primary text. |
| `--text-muted` | `#a8adb7` | Labels and secondary text. |
| `--text-soft` | `#7f8794` | Metadata and low-emphasis UI. |

Light mode:

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#f5f7f9` | Page background and light browser theme color. |
| `--surface` | `#ffffff` | Panels, controls, menus. |
| `--surface-muted` | `#eef2f5` | Empty states, dropzones, subtle contrast. |
| `--border` | `#d7dee4` | Default dividers and control borders. |
| `--border-strong` | `#c1ccd4` | Emphasized borders. |
| `--text` | `#1e252b` | Primary text. |
| `--text-muted` | `#606b75` | Labels and secondary text. |
| `--text-soft` | `#84909a` | Metadata and low-emphasis UI. |

Light mode should feel like a soft cool workspace gray, not cream, beige, or aged paper.

## Semantic Colors

| Meaning | Token | Dark | Light | Use |
| --- | --- | --- | --- | --- |
| Runnable system | `--accent` | `#5fabc2` | `#064f6e` | Scripts, processors, upload affordances, local processing, selected files, active role slots. |
| Run moment | `--run` | `#e2b540` | `#e2b540` | Run button, active execution, cursor/progress pulse. |
| Success | `--success` | `#98c379` | `#4f8f3a` | Ready/completed states, successful output, valid/matched indicators, download after success. |
| Warning | `--warning` | `#c4863a` | `#8a5200` | Non-blocking issues and cautionary guidance. |
| Error | `--danger` | `#f44747` | `#c92f32` | Fatal validation/runtime failures only. |

Yellow ocher is the run/action color, not a warning or error color. Red is reserved for fatal failures so the Run action never looks dangerous.

## Supporting Tokens

Semantic colors have theme-specific strong, soft, and border variants. Do not mechanically invert colors across themes; tune each soft token for contrast and calmness.

Important supporting tokens:

- `--accent-strong`
- `--accent-soft`
- `--run-strong`
- `--run-soft`
- `--run-border`
- `--success-strong`
- `--success-soft`
- `--success-border`
- `--warning-soft`
- `--warning-border`
- `--danger-soft`
- `--danger-border`
- `--danger-text-soft`
- `--file-accent-bg`
- `--file-accent-border`

Uploaded file rows and selected role slots intentionally use the blue process treatment because they are active inputs to the runnable system.

## Component Rules

- Keep most structure neutral: surfaces, text, metadata, secondary buttons, menus, and normal labels should use white/gray tokens.
- Use Vandar Poel's Blue and its dark-mode lift sparingly for the runnable system: script icons, upload affordances, file rows, selected role slots, detected table accents, local processing, and theme selected states.
- Use yellow ocher only for run intent or active processing.
- Use green only after success or validation-positive states.
- Use amber for warnings and non-blocking guidance.
- Use red only for fatal validation or runtime failure.
- Secondary actions stay neutral unless they carry semantic state.
- Do not add decorative gradients, bokeh, or standalone color blobs.
- Keep operational UI dense and scannable, not marketing-like.

## Theme Controls And Brand

- The topbar theme control lives near "Local processing".
- Desktop uses a compact segmented control with Auto, Light, and Dark labels plus icons.
- Narrow screens use an icon button with a menu.
- The topbar brand mark should visually disappear into the dark topbar background and show a subtle border in light mode.
- The favicon should use the same dark topbar shade in dark mode and show a visible border in light mode.

## CSS Organization

`src/styles.css` is only an import manifest. Keep component styles in:

```text
src/styles/00-theme-base.css
src/styles/10-topbar-theme-toggle.css
src/styles/20-workspace-shell.css
src/styles/30-script-selector.css
src/styles/40-help-modal.css
src/styles/50-inputs-and-actions.css
src/styles/60-results.css
src/styles/90-responsive.css
```

Add new style rules to the closest matching file. Create another numbered CSS file only when a new feature area would otherwise make an existing file hard to scan.

# Design Palette

Open Commander supports auto, dark, and light color modes. Auto is the default and follows the OS/browser `prefers-color-scheme` value. The favicon is the source metaphor:

- cyan chevron: runnable system
- coral cursor: the run moment

Most interface text and structure should stay neutral. Color should identify meaning, not decorate the page.

## Theme Modes

The active choice is stored in `localStorage` as `open-commander-theme` and mirrored on the document element:

```text
<html data-theme="auto">
<html data-theme="dark">
<html data-theme="light">
<html data-theme="auto" data-resolved-theme="light">
```

CSS theme tokens are keyed from `data-resolved-theme`, which is set to `light` or `dark` after resolving `auto` against `prefers-color-scheme`. This keeps auto behavior without duplicating the full light token block.

## Dark Neutrals

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| App background | `--bg` | `#181818` | Page background and browser theme color. |
| Surface | `--surface` | `#202124` | Main panels, cards, controls. |
| Muted surface | `--surface-muted` | `#282c34` | Empty states, subtle contrast, dropzones. |
| Border | `--border` | `#3a3f4b` | Default dividers and control borders. |
| Strong border | `--border-strong` | `#4a5160` | Focused or emphasized structure. |
| Text | `--text` | `#e6e6e6` | Primary text. |
| Muted text | `--text-muted` | `#a8adb7` | Secondary text and labels. |
| Soft text | `--text-soft` | `#7f8794` | Metadata and low-emphasis UI. |

## Light Neutrals

The light theme should stay calm and slightly warm, not beige-heavy or office-white.

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| App background | `--bg` | `#f8f9f4` | Page background and browser theme color. |
| Surface | `--surface` | `#ffffff` | Main panels, cards, controls. |
| Muted surface | `--surface-muted` | `#f1f4f1` | Empty states, subtle contrast, dropzones. |
| Border | `--border` | `#d9ded8` | Default dividers and control borders. |
| Strong border | `--border-strong` | `#c2cbc2` | Focused or emphasized structure. |
| Text | `--text` | `#1d2420` | Primary text. |
| Muted text | `--text-muted` | `#657069` | Secondary text and labels. |
| Soft text | `--text-soft` | `#879188` | Metadata and low-emphasis UI. |

## Semantic Color Rules

| Meaning | Token | Dark | Light | Use For | Avoid Using For |
| --- | --- | --- | --- | --- | --- |
| Runnable system | `--accent` | `#56b6c2` | `#1f8c96` | Scripts, processors, upload/process affordances, local execution context, file-processing icons. | Body text, generic labels, unrelated decoration. |
| Run moment | `--run` | `#ff6b7a` | `#e85d6c` | Run button, active execution, cursor/progress pulse. | Generic errors or warnings. |
| Success | `--success` | `#98c379` | `#4f8f3a` | Ready/completed states, successful output, valid/matched indicators, download after successful run. | Runnable affordances before execution. |
| Warning | `--warning` | `#e5c07b` | `#9a6400` | Non-blocking issues, unmatched rows, cautionary guidance. | Fatal failures. |
| Error | `--danger` | `#f44747` | `#c92f32` | Fatal validation/runtime failures only. | Run button or normal execution affordances. |

## Implementation Notes

- Coral is not the error color. It means execution.
- Errors use deeper red so the Run button does not feel dangerous.
- Cyan should be rare enough that it points to the runnable system.
- Success green should appear only after a successful or valid state exists.
- Secondary actions should remain neutral unless they carry semantic meaning.
- The browser favicon is self-contained, but the top bar brand mark is a theme-aware inline mark with no visible dark background and a subtle light border.
- Script cards keep the spreadsheet/page icon.
- The theme toggle lives in the top bar near "Local processing"; narrower screens use a compact icon menu instead of the full segmented control.
- Uploaded file rows can use subtle cyan treatment because selected workbooks are part of the runnable system.

## Supporting Tokens

Each semantic color has theme-specific stronger text/hover values, soft background values, and sometimes border values. Soft tokens must be tuned for their theme instead of inverted mechanically:

| Base | Strong | Soft | Border |
| --- | --- | --- | --- |
| `--accent: #56b6c2` | `--accent-strong: #8bdce5` | `--accent-soft: #1f3338` | use `--border` unless extra emphasis is needed |
| `--run: #ff6b7a` | `--run-strong: #ff8794` | `--run-soft: #351f26` | `--run-border: #77424d` |
| `--success: #98c379` | `--success-strong: #b6d88a` | `--success-soft: #24301f` | use a muted green border |
| `--warning: #e5c07b` | same as base | `--warning-soft: #332a1a` | use a muted amber border |
| `--danger: #f44747` | same as base | `--danger-soft: #351b1d` | `--danger-border: #703232` |

Light soft tokens use pale teal, coral, green, amber, and red backgrounds so semantic meaning remains visible without making the interface feel saturated.

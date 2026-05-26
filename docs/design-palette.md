# Design Palette

Open Commander uses a restrained dark interface with selective semantic color. The favicon is the source metaphor:

- cyan chevron: runnable system
- coral cursor: the run moment

Most interface text and structure should stay white or gray. Color should identify meaning, not decorate the page.

## Core Neutrals

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

## Semantic Color Rules

| Meaning | Token | Value | Use For | Avoid Using For |
| --- | --- | --- | --- | --- |
| Runnable system | `--accent` | `#56b6c2` | Scripts, processors, upload/process affordances, local execution context, file-processing icons. | Body text, generic labels, unrelated decoration. |
| Run moment | `--run` | `#ff6b7a` | Run button, active execution, cursor/progress pulse. | Generic errors or warnings. |
| Success | `--success` | `#98c379` | Ready/completed states, successful output, valid/matched indicators, download after successful run. | Runnable affordances before execution. |
| Warning | `--warning` | `#e5c07b` | Non-blocking issues, unmatched rows, cautionary guidance. | Fatal failures. |
| Error | `--danger` | `#f44747` | Fatal validation/runtime failures only. | Run button or normal execution affordances. |

## Implementation Notes

- Coral is not the error color. It means execution.
- Errors use deeper red so the Run button does not feel dangerous.
- Cyan should be rare enough that it points to the runnable system.
- Success green should appear only after a successful or valid state exists.
- Secondary actions should remain neutral unless they carry semantic meaning.
- The top bar brand mark uses `/favicon.svg`; script cards keep the spreadsheet/page icon.

## Supporting Tokens

Each semantic color can have a stronger text/hover value, a soft background value, and sometimes a border value:

| Base | Strong | Soft | Border |
| --- | --- | --- | --- |
| `--accent: #56b6c2` | `--accent-strong: #8bdce5` | `--accent-soft: #1f3338` | use `--border` unless extra emphasis is needed |
| `--run: #ff6b7a` | `--run-strong: #ff8794` | `--run-soft: #351f26` | `--run-border: #77424d` |
| `--success: #98c379` | `--success-strong: #b6d88a` | `--success-soft: #24301f` | use a muted green border |
| `--warning: #e5c07b` | same as base | `--warning-soft: #332a1a` | use a muted amber border |
| `--danger: #f44747` | same as base | `--danger-soft: #351b1d` | `--danger-border: #703232` |

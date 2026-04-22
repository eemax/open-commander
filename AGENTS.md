# Agent Handoff Notes

This file is for future coding agents working on Open Commander.

## Current State

Open Commander is a browser-only Excel script runner hosted as static assets on Cloudflare. The current Cloudflare setup uses Workers static assets through Wrangler because the project requires a deploy command. There is no backend, no database, no file storage, and no custom Cloudflare Worker API for the current workflow.

The first screen is a script selector. The only implemented script is URL Generator:

- input: one orders `.xlsx` workbook and one EAN `.xlsx` workbook
- output: one generated `.xlsx` workbook
- processing location: browser Web Worker

## Commands

Use these from the repository root:

```sh
npm install
npm run dev
npm test
npm run build
npm run preview
npm run deploy
```

Typical local URLs:

```text
Dev: http://127.0.0.1:5173/
Preview: http://127.0.0.1:4173/
```

Vite may choose another port if the default is busy.

## Important Files

```text
src/app/App.tsx
src/app/runInWorker.ts
src/workers/scriptRunner.worker.ts
src/scripts/registry.ts
src/scripts/urlGenerator/excel.ts
src/scripts/urlGenerator/transform.ts
src/scripts/urlGenerator/headers.ts
src/scripts/urlGenerator/fileRoles.ts
src/scripts/urlGenerator/types.ts
src/scripts/urlGenerator/*.test.ts
src/styles.css
```

## Architecture Rules

- Keep source file processing client-side unless the user explicitly asks for backend compute.
- Keep business logic pure and testable outside ExcelJS.
- Keep workbook IO in `excel.ts` or equivalent script-specific IO modules.
- Keep Web Worker routing in `src/workers/scriptRunner.worker.ts`.
- Keep script metadata in `src/scripts/registry.ts`.
- Keep the top-level script selector generic; put script-specific inputs behind the selected script's workspace.
- Do not introduce storage for uploaded files unless the user explicitly changes the product requirements.
- Preserve the 5 MB per-file limit unless the user changes it.

## URL Generator Behavior

The old Python script was ported and improved. Preserve these behaviors unless asked otherwise:

- Accepts flexible headers for orders and EAN workbooks.
- Detects a likely header row near the top of the sheet.
- Falls back to positional columns when no header row is found.
- Skips incomplete rows and reports them.
- Matches products case-insensitively and ignores spaces, dots, underscores, and hyphens.
- Deduplicates repeated EAN rows.
- Creates URLs with this shape:

```text
{base_url}/01/{ean}/10/{purchase_order}
```

- Writes `urls`, `summary`, and optional `unmatched_orders` / `input_issues` sheets.

## Before Finishing Changes

Run:

```sh
npm test
npm run build
```

For UI changes, also run:

```sh
npm run dev
```

Then open the printed local URL and smoke-test upload, role selection, run, and download with small `.xlsx` workbooks.

## Cloudflare Deployment

Deployment settings:

```text
Build command: npm run build
Deploy command: npm run deploy
Non-production branch deploy command: npm run deploy:preview
Root directory: /
```

`wrangler.jsonc` deploys the built `dist` directory as static assets with single-page app fallback. No Cloudflare bindings are required.

## Things To Watch

- ExcelJS browser bundles can be large. Keep an eye on build output if adding dependencies.
- Tests run in Node, but the production code runs in a browser worker. Keep workbook-level tests and production builds green.
- `App.tsx` has a generic script selector, but the opened workspace currently assumes URL Generator's two-workbook input shape. Adding scripts with different inputs likely requires per-script workspace components.
- `zod` is installed but not currently used by URL Generator.
- This directory is initialized as a git repository on `main`, but the initial files may still be uncommitted.

# Agent Handoff Notes

This file is for future coding agents working on Open Commander.

## Current State

Open Commander is a browser-only Excel script runner hosted as static assets on Cloudflare. The current Cloudflare setup uses Workers static assets through Wrangler because the project requires a deploy command. There is no backend, no database, no file storage, and no custom Cloudflare Worker API for the current workflow.

The first screen is a script selector. The only implemented script is URL Generator:

- input: one orders `.xlsx` workbook and one EAN `.xlsx` workbook
- output: one generated `.xlsx` workbook
- processing location: browser Web Worker, with progress stages, one automatic retry, and a user-triggered main-thread compatibility mode for processor/runtime failures
- successful result UI: summary, first five generated URL rows, detected headers, non-fatal issues, and output download

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
public/templates/*.xlsx
```

## Architecture Rules

- Keep source file processing client-side unless the user explicitly asks for backend compute.
- Keep business logic pure and testable outside ExcelJS.
- Keep workbook IO in `excel.ts` or equivalent script-specific IO modules.
- Keep Web Worker routing in `src/workers/scriptRunner.worker.ts`.
- Keep processor/runtime failures separate from validation failures. Validation failures should show row-level input issues and should not trigger retry/compatibility mode.
- Keep script metadata in `src/scripts/registry.ts`.
- Keep the top-level script selector generic; put script-specific inputs behind the selected script's workspace.
- Do not introduce storage for uploaded files unless the user explicitly changes the product requirements.
- Preserve the 5 MB per-file limit unless the user changes it.

## URL Generator Behavior

The old Python script was ported and improved. Preserve these behaviors unless asked otherwise:

- Accepts flexible headers for orders and EAN workbooks.
- Detects a likely header row near the top of the sheet.
- Does not fall back to positional columns. If no recognizable header row is found, the run fails with input issues.
- Skips incomplete rows during extraction and reports them as fatal input issues.
- Matches products case-insensitively and ignores spaces, dots, underscores, and hyphens.
- Allows one purchase order to contain multiple products. Duplicate normalized purchase order/product combinations are rejected.
- Rejects duplicate EAN and duplicate SKU values.
- Rejects invalid Base URLs. Base URLs must be `https://` root domains, must not include `www.`, paths, query strings, hashes, credentials, or the `example.com` template placeholder.
- For each valid order row, creates one URL row for every EAN row that matches the order product.
- Creates URLs with this shape:

```text
{base_url}/01/{ean}/10/{purchase_order}
```

- Writes `urls`, `summary`, and optional `unmatched_orders` / `input_issues` sheets for successful runs. Fatal input errors stop the run before an output workbook is created.
- Exposes `previewRows` on successful run results for the first five generated URL rows shown in the UI.

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
- User-facing failure copy should stay browser-neutral unless the app explicitly detects the browser. Technical error details may include `navigator.userAgent`.

# Agent Handoff Notes

This is the working checklist for future coding agents. The README is the user-facing project documentation; keep this file focused on implementation context, invariants, and traps.

## Snapshot

Open Commander is a Vite/React/TypeScript app that runs small Excel scripts entirely in the browser. It is deployed as Cloudflare Workers static assets from `dist`.

There is no backend, database, object storage, KV, file upload, or custom Worker API in the current product. Source workbooks are read by browser APIs and processed locally.

The only implemented script is URL Generator:

- one orders `.xlsx` workbook
- one EAN/UPC `.xlsx` workbook
- one generated output `.xlsx` workbook
- normal execution in a browser Web Worker
- one automatic worker retry for runtime/processor failures
- optional main-thread compatibility mode after retry failure
- validation failures are row-level input issues and must not trigger retry/compatibility mode
- URL Generator workspace includes a simple Help modal for non-technical users

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

## Change Map

- `src/app/App.tsx`: current UI, file selection, role selection, worker retry, compatibility mode, result/error rendering. It is generic at the first script-selector screen but URL-Generator-specific after a script is opened.
- `src/app/runInWorker.ts`: creates the browser worker, tracks last reported stage, maps worker responses into `WorkerRunError` or `WorkerUnexpectedError`.
- `src/workers/scriptRunner.worker.ts`: worker entry point and script routing. Dynamic-imports the Excel engine.
- `src/scripts/registry.ts`: script metadata shown on the selector screen.
- `src/scripts/urlGenerator/types.ts`: shared URL Generator types, file limit, script ID, run stages.
- `src/scripts/urlGenerator/excel.ts`: ExcelJS workbook read/write and fatal input issue boundary.
- `src/scripts/urlGenerator/transform.ts`: pure business rules, validation, URL creation, sorting.
- `src/scripts/urlGenerator/headers.ts`: header normalization, scoring, and table-layout detection.
- `src/scripts/urlGenerator/fileRoles.ts`: filename role detection and output filename derivation.
- `src/scripts/urlGenerator/*.test.ts`: transform, workbook, and filename-role coverage.
- `public/templates/*.xlsx`: user-downloadable workbook templates. Edit with ExcelJS or a proper workbook tool, not plain text.
- `src/styles.css`: CSS import manifest. Component and responsive styling lives in `src/styles/*.css`.

## Architecture Rules

- Keep workbook processing client-side unless the user explicitly changes the product requirements.
- Keep business logic pure and testable outside ExcelJS.
- Keep workbook IO in script-specific modules like `urlGenerator/excel.ts`.
- Keep worker routing in `src/workers/scriptRunner.worker.ts`.
- Keep script metadata in `src/scripts/registry.ts`.
- Keep validation failures separate from runtime/processor failures.
- Do not add storage or upload flows for source files unless explicitly requested.
- Preserve the 5 MB per-file limit unless the user changes it.
- Prefer focused tests around transform behavior first, then workbook-level tests for ExcelJS read/write contracts.

## Naming Gotchas

- The internal file role is still `eans` even though the workbook is user-facing EAN/UPC. Do not casually rename this role; it touches UI selection, worker payloads, tests, file role detection, and output naming.
- `EanRecord` now represents an EAN/UPC identifier row. The name is legacy.
- Internal `GtinMode` uses `"upc_only"`, but output workbook cells serialize it as `upc only`.
- `identifier_type` is `"ean"` or `"upc"`. `identifier` is the actual value used in the generated URL.
- The old `ean_row_number` output column has been replaced by `identifier_row_number`.

## URL Generator Invariants

Preserve these behaviors unless the user asks to change them:

- Accept flexible headers for orders and EAN/UPC workbooks.
- Scan near the top of the sheet for a likely header row.
- Do not fall back to positional columns.
- Trim leading/trailing whitespace from all cell text and strip leading Excel apostrophes.
- Report missing required columns and empty required cells as fatal input issues.
- Match products case-insensitively and ignore spaces, dots, underscores, and hyphens.
- Allow one purchase order to contain multiple products.
- Reject duplicate normalized purchase order/product combinations.
- Reject duplicate EAN, duplicate UPC, and duplicate SKU values.
- Treat EAN as the default identifier mode.
- Do not accept `gtin` as an identifier header.
- Require explicit `upc only` mode when only UPC exists.
- Require both EAN and UPC values for `upc` mode.
- Warn, but continue, when `upc only` mode also includes an EAN value.
- Preserve simple zero-padded numeric formats when ExcelJS exposes the number format.
- Validate Base URLs even for unmatched order products.
- Collect Base URL errors during orders extraction so they appear alongside EAN/UPC validation errors.
- Create one output URL row for every matching order/product and identifier row.
- Sort output by purchase order, normalized product, product, SKU, identifier type, then identifier.
- Stop before writing an output workbook if any fatal input errors exist.
- Include `previewRows` as the first five generated URL rows on successful runs.
- On failed validation runs, the UI shows up to the first 50 fatal input issues from the current validation pass.

## Base URL Rules

Base URLs must be `https://` root domains. They must not include:

- `www.`
- paths
- query strings
- hashes
- usernames or passwords
- the template placeholder domain `id.example.com`

Trailing slashes are allowed and removed. `example.com` itself is allowed; only `id.example.com` is the rejected template placeholder.

## Header Detection Notes

Header matching normalizes case, accents, punctuation, separators, and common symbols. Header rows are selected from the first 15 rows.

A likely header row currently needs at least two matched known columns. This can include optional columns. That behavior is intentional because it lets the app detect a partial EAN/UPC header row and then report a missing required `product` column instead of falling all the way back to "no recognizable header row."

## Failure Model

Validation path:

```text
excel.ts reads workbook rows
  -> transform extracts records and issues
  -> FatalInputIssueError is thrown for severity:error issues
  -> worker reports kind: input-issues
  -> UI shows row-level fixes, no retry, no compatibility mode
```

Runtime path:

```text
worker creation/message/import/read/write failure
  -> WorkerUnexpectedError or WorkerRunError(kind: runtime)
  -> UI rereads files and retries once
  -> after retry failure, UI offers compatibility mode
  -> after compatibility failure, UI suggests trying Google Chrome
```

Keep user-facing failure copy browser-neutral unless the app explicitly detects a browser. Technical details may include `navigator.userAgent`.

## Output Workbook Contract

Successful runs always write:

- `urls`
- `summary`

Successful runs may also write:

- `unmatched_orders`
- `input_issues`

The `urls` sheet columns are:

```text
purchase_order
product
sku
identifier_type
identifier
ean
upc
mode
base_url
url
order_row_number
identifier_row_number
```

Generated URL shape:

```text
{base_url}/01/{identifier}/10/{purchase_order}
```

## Template Notes

- Orders template base URL should remain `https://id.example.com`; validation rejects it in uploaded data so users cannot accidentally ship the placeholder.
- EAN/UPC template should show all supported modes: blank EAN default, `upc`, and `upc only`.
- Keep identifier template columns formatted as text when needed so leading zeroes survive.

## Design Palette Notes

Palette rules live in `docs/design-palette.md`. The app supports `auto`, `light`, and `dark` theme modes, stored as `open-commander-theme` and reflected on `<html data-theme="...">`; CSS tokens use `<html data-resolved-theme="light|dark">` after resolving auto. Preserve the semantic color split in both dark and light token sets:

- cyan means runnable system: scripts, processors, upload/process affordances, local execution context
- coral means the run moment: Run button, active execution, cursor/progress pulse
- green means success: ready/completed states, successful output, valid/matched indicators
- amber means warning: non-blocking issues and cautionary guidance
- red means fatal error: validation/runtime failures only
- white/gray carries normal UI text, labels, navigation, metadata, and secondary controls

Do not reuse coral as the generic error color; errors use a deeper red so the Run action does not look dangerous.

Keep the light theme calm and slightly warm, not beige-heavy. Theme-aware values include soft semantic backgrounds, topbar alpha, modal backdrop/shadow, disabled controls, uploaded file accents, topbar logo frame, and mobile sticky button shadow.

## Before Finishing Changes

Always run:

```sh
npm test
npm run build
```

For UI changes, also run:

```sh
npm run dev
```

Then open the printed local URL and smoke-test upload, role selection, run, and download with small `.xlsx` workbooks. If browser automation is unavailable, say so in the final response.

## Deployment

Cloudflare Workers static-assets settings:

```text
Build command: npm run build
Deploy command: npm run deploy
Non-production branch deploy command: npm run deploy:preview
Root directory: /
```

`wrangler.jsonc` uses `assets.directory = "./dist"` with single-page app fallback. No bindings are required.

## Things To Watch

- ExcelJS browser bundles are large. Build output will warn about chunk size.
- Tests run in Node, but production workbook processing runs in a browser worker.
- `App.tsx` will need a script-specific workspace split before adding scripts with a different input shape.
- The CSP in `public/_headers` must continue to allow the bundled worker to run under `worker-src 'self'`.
- Browser/runtime failures and validation failures deliberately have different recovery paths; do not collapse them into one generic error.

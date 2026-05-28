# Agent Handoff

This file is for coding agents. Keep it practical: architecture facts, invariants, traps, and verification steps. The README is the user-facing project guide.

## Product Snapshot

Open Commander is a Vite, React, and TypeScript app that runs small Excel scripts entirely in the browser. It is deployed as Cloudflare Workers static assets from `dist`.

Current product boundaries:

- No backend API.
- No database, object storage, KV, queues, or custom Worker handlers.
- No server-side file upload.
- Source workbooks are read with browser `File` APIs.
- Generated workbooks are created locally and downloaded from the browser.

The only implemented script is URL Generator. It accepts:

- one orders `.xlsx` workbook
- one EAN/UPC `.xlsx` workbook
- one generated output `.xlsx` workbook

Normal execution runs in a browser Web Worker. Runtime or processor failures get one automatic worker retry. After that, the UI can offer main-thread compatibility mode. Validation failures are input issues and must not trigger retry or compatibility mode.

## Commands

Run from the repository root:

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

## Source Map

App shell and UI:

- `src/app/App.tsx`: URL Generator workspace orchestration, file state, role state, worker retry, compatibility mode, and top-level screen flow.
- `src/app/ScriptSelector.tsx`: generic first-screen script selector.
- `src/app/ThemeModeControl.tsx`, `src/app/theme.ts`, `src/app/BrandLogo.tsx`: color mode UI, persistence, document attributes, and inline brand mark.
- `src/app/UrlGeneratorHelpModal.tsx`: non-technical help modal for URL Generator.
- `src/app/RunProgress.tsx`, `src/app/RunFailureView.tsx`, `src/app/ResultView.tsx`: run status, failure display, output preview, and issue display.
- `src/app/fileSelection.ts`, `src/app/runFailure.ts`, `src/app/runStatus.ts`, `src/app/constants.ts`, `src/app/types.ts`: shared app helpers and types.
- `src/app/runInWorker.ts`: browser worker lifecycle, last-stage tracking, and worker error mapping.

Script engine:

- `src/workers/scriptRunner.worker.ts`: worker entry point and script routing.
- `src/scripts/registry.ts`: metadata for scripts shown in the selector.
- `src/scripts/urlGenerator/types.ts`: URL Generator constants, shared types, run stages, and output contracts.
- `src/scripts/urlGenerator/excel.ts`: ExcelJS workbook read/write and fatal input issue boundary.
- `src/scripts/urlGenerator/transform.ts`: pure URL Generator record extraction, validation, matching, URL row building, and sorting.
- `src/scripts/urlGenerator/baseUrl.ts`: Base URL validation, normalization, and generated URL formatting.
- `src/scripts/urlGenerator/headers.ts`: header normalization, alias matching, scoring, and table-layout detection.
- `src/scripts/urlGenerator/fileRoles.ts`: filename role detection and output filename derivation.
- `src/scripts/urlGenerator/*.test.ts`: transform, workbook, and filename-role coverage.

Assets and styling:

- `public/templates/*.xlsx`: downloadable workbook templates. Edit these with ExcelJS or a workbook tool, not plain text.
- `public/favicon.svg`: theme-aware favicon.
- `public/_headers`: Cloudflare static asset headers and CSP.
- `src/styles.css`: CSS import manifest.
- `src/styles/*.css`: theme tokens, topbar, workspace shell, script selector, modal, controls, results, and responsive rules.
- `docs/design-palette.md`: semantic color and theme rules.

## Architecture Rules

- Keep workbook processing client-side unless the user explicitly changes the product requirements.
- Keep business logic pure and testable outside ExcelJS.
- Keep workbook IO in script-specific modules such as `src/scripts/urlGenerator/excel.ts`.
- Keep worker routing in `src/workers/scriptRunner.worker.ts`.
- Keep script metadata in `src/scripts/registry.ts`.
- Keep validation failures separate from runtime failures.
- Do not add storage or upload flows for source files unless explicitly requested.
- Preserve the 5 MB per-file limit unless the user changes it.
- Keep hand-authored files under 1,000 lines where practical. `package-lock.json` is generated and exempt.

## URL Generator Invariants

Preserve these behaviors unless the user asks to change them:

- Accept flexible headers for orders and EAN/UPC workbooks.
- Scan only near the top of the sheet for a likely header row.
- Do not fall back to positional columns.
- Trim leading and trailing whitespace from all cell text.
- Strip leading Excel apostrophes.
- Preserve simple zero-padded numeric formats when ExcelJS exposes the number format.
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
- Validate Base URLs even for unmatched order products.
- Collect Base URL errors during orders extraction so they appear alongside EAN/UPC validation errors.
- Create one output URL row for every matching order/product and identifier row.
- Sort output by purchase order, normalized product, product, SKU, identifier type, then identifier.
- Stop before writing an output workbook if any fatal input errors exist.
- Include `previewRows` as the first five generated URL rows on successful runs.
- On failed validation runs, show up to the first 50 fatal input issues from the current validation pass.

## Naming Traps

- Internal file role `eans` means the user-facing EAN/UPC workbook. Do not casually rename it.
- `EanRecord` represents an EAN/UPC identifier row. The name is legacy.
- Internal `GtinMode` uses `"upc_only"`, but output workbook cells serialize it as `upc only`.
- `identifier_type` is `"ean"` or `"upc"`.
- `identifier` is the actual value used in the generated URL.
- The old `ean_row_number` output column has been replaced by `identifier_row_number`.

## Base URL Contract

Base URLs must be `https://` root domains. They must not include:

- `www.`
- paths
- query strings
- hashes
- usernames or passwords
- the template placeholder domain `id.example.com`

Trailing slashes are allowed and removed. `example.com` itself is allowed; only `id.example.com` is rejected as the template placeholder.

## Header Detection Notes

Header matching normalizes case, accents, punctuation, separators, and common symbols. Header rows are selected from the first 15 rows.

A likely header row currently needs at least two matched known columns. This can include optional columns. That is intentional: it lets the app detect a partial EAN/UPC header row and report a missing required `product` column instead of falling back to "no recognizable header row."

## Failure Model

Validation path:

```text
excel.ts reads workbook rows
  -> transform extracts records and issues
  -> FatalInputIssueError is thrown for severity:error issues
  -> worker reports kind: input-issues
  -> UI shows row-level fixes
  -> no retry and no compatibility mode
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

## Theme And Design Rules

Palette rules live in `docs/design-palette.md`.

The app supports `auto`, `light`, and `dark` modes. The choice is stored as `open-commander-theme`, mirrored on `<html data-theme="...">`, and resolved to `<html data-resolved-theme="light|dark">` for CSS tokens.

Preserve the semantic color split:

- Blue means runnable system: scripts, processors, upload/process affordances, local execution context, selected workbooks, and active role slots.
- Yellow ocher means the run moment: Run button, active execution, cursor/progress pulse.
- Green means success: ready/completed states, successful output, valid/matched indicators, download after success.
- Amber means warning: non-blocking issues and cautionary guidance.
- Red means fatal error: validation/runtime failures only.
- White/gray carries normal UI text, labels, navigation, metadata, and secondary controls.

Do not reuse yellow ocher as the generic warning or error color.

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

Then open the printed local URL and smoke-test the changed workflow. For URL Generator UI changes, test upload, role selection, run, and download with small `.xlsx` workbooks. If browser automation is unavailable, say so in the final response.

## Deployment Notes

Cloudflare Workers static asset settings:

```text
Build command: npm run build
Deploy command: npm run deploy
Non-production branch deploy command: npm run deploy:preview
Root directory: /
```

`wrangler.jsonc` uses `assets.directory = "./dist"` with single-page app fallback. No bindings are required.

Keep `public/_headers` compatible with browser workers. The CSP must continue to allow `worker-src 'self'`.

## Known Weight

- ExcelJS browser bundles are large. Production build warns about chunks over 500 kB.
- The main app and worker each load ExcelJS because compatibility mode can run on the main thread after worker failure.
- Tests run in Node, but production workbook processing runs in a browser worker.

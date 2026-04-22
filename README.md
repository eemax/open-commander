# Open Commander

Open Commander is a Cloudflare Pages-ready web app for running small Excel-processing scripts in the user's browser. The app does not upload source workbooks to a backend, does not store files, and does not require server-side compute for the current workflow.

The first script is **URL Generator**. It takes one orders workbook and one EAN workbook, matches rows by product, and produces a downloadable `.xlsx` output with generated URLs.

## Stack

- Vite
- React
- TypeScript
- ExcelJS
- Web Workers
- Vitest
- Cloudflare Pages

`zod` is installed for future structured validation work, but the current URL Generator uses purpose-built validation helpers in `src/scripts/urlGenerator`.

## Requirements

- Node.js 24 or newer is recommended.
- npm 11 or newer is recommended.

The project was initially built and verified with:

```sh
node --version
# v24.13.0

npm --version
# 11.12.1
```

## Local Development

Install dependencies:

```sh
cd /Users/max/open-commander
npm install
```

Start the local dev server:

```sh
npm run dev
```

The app normally runs at:

```text
http://127.0.0.1:5173/
```

If port `5173` is busy, Vite will choose another port, such as `5174`, and print the actual URL in the terminal.

## Production Preview

Build the app:

```sh
npm run build
```

Preview the production build locally:

```sh
npm run preview
```

The preview server normally runs at:

```text
http://127.0.0.1:4173/
```

## Test Commands

Run all tests:

```sh
npm test
```

Run tests in watch mode:

```sh
npm run test:watch
```

The current tests cover:

- flexible header detection
- fallback positional columns when no header row exists
- skipped incomplete rows
- duplicate EAN row handling
- workbook read/write behavior through ExcelJS

## Cloudflare Pages Deployment

Use these Cloudflare Pages settings:

```text
Build command: npm run build
Build output directory: dist
Root directory: /
```

No server routes, database, object storage, KV namespace, or Worker binding is required for the current app.

The generated `dist` folder is static assets only. The Excel processing code is bundled into a browser Web Worker.

## User Workflow

1. Open the app.
2. Choose a script from the script selector.
3. Drop or select `.xlsx` files.
4. Choose one orders workbook and one EAN workbook.
5. Run the script.
6. Download the generated output workbook.

The app enforces a 5 MB maximum per file. Files are read locally with browser APIs and processed in a Web Worker.

## URL Generator Input

The current script expects two workbooks:

- Orders workbook
- EAN workbook

File names are auto-detected when possible:

- `*_orders.xlsx` is treated as orders.
- `*_eans.xlsx` is treated as EANs.

The UI still lets the user manually choose which file is which.

### Orders Columns

Required fields:

- `purchase_order`
- `product`
- `base_url`

Accepted header examples include:

- Purchase order: `purchase_order`, `purchase order`, `purchase order number`, `po`, `po number`, `order number`
- Product: `product`, `product code`, `product_code`, `item`, `item code`, `article`, `style`, `sku`
- Base URL: `base_url`, `base url`, `url`, `link`, `web link`, `base link`

If no header row is detected, the script falls back to:

```text
Column A: purchase_order
Column B: product
Column C: base_url
```

### EAN Columns

Required fields:

- `product`
- `ean`

Optional field:

- `sku`

Accepted header examples include:

- Product: `product`, `product code`, `product_code`, `item`, `item code`, `article`, `style`, `sku`
- EAN: `ean`, `eans`, `barcode`, `bar code`, `gtin`, `upc`
- SKU: `sku`, `variant sku`, `size sku`, `internal sku`

If no header row is detected, the script falls back to:

```text
Column A: product
Column B: ean
Column C: sku
```

## URL Generator Output

The generated workbook always includes:

- `urls`
- `summary`

It may also include:

- `unmatched_orders`, when any order product has no matching EAN product
- `input_issues`, when warnings, errors, or informational notices were recorded

The main URL format is:

```text
{base_url}/01/{ean}/10/{purchase_order}
```

The script trims trailing slashes from `base_url` and URL-encodes the EAN and purchase order path segments.

## Project Structure

```text
public/
  _headers

src/
  app/
    App.tsx
    runInWorker.ts

  lib/
    download.ts

  scripts/
    registry.ts
    urlGenerator/
      excel.ts
      excel.test.ts
      fileRoles.ts
      headers.ts
      transform.ts
      transform.test.ts
      types.ts

  workers/
    scriptRunner.worker.ts

  main.tsx
  styles.css
  vite-env.d.ts
```

Key files:

- `src/app/App.tsx`: main UI for the script selector, URL Generator workspace, file selection, role selection, run state, results, and download.
- `src/app/runInWorker.ts`: browser-side wrapper that sends files to the Web Worker.
- `src/workers/scriptRunner.worker.ts`: worker entry point for running scripts off the main thread.
- `src/scripts/registry.ts`: list of scripts exposed by the app.
- `src/scripts/urlGenerator/excel.ts`: reads source workbooks and writes the output workbook.
- `src/scripts/urlGenerator/transform.ts`: pure URL Generator business logic.
- `src/scripts/urlGenerator/headers.ts`: flexible header normalization and detection.
- `src/scripts/urlGenerator/fileRoles.ts`: filename role detection and output filename derivation.
- `src/scripts/urlGenerator/types.ts`: shared script types.

## Data Flow

```text
React UI
  -> user chooses a script from the selector
  -> user selects .xlsx files
  -> file roles are detected from names
  -> user confirms orders and EAN files
  -> App reads File objects as ArrayBuffer
  -> runInWorker posts buffers to scriptRunner.worker
  -> worker calls runUrlGenerator
  -> ExcelJS reads both workbooks
  -> transform logic extracts records and builds URLs
  -> ExcelJS writes the output workbook
  -> worker returns ArrayBuffer to UI
  -> UI creates a Blob download
```

## Adding Another Script

The app is intended to grow into a small script runner. For a new script:

1. Create a folder under `src/scripts/<scriptName>/`.
2. Keep business logic pure where possible, similar to `urlGenerator/transform.ts`.
3. Keep ExcelJS-specific workbook read/write code separate, similar to `urlGenerator/excel.ts`.
4. Add tests for the pure transform first.
5. Add a workbook-level test if the script reads or writes `.xlsx`.
6. Register the script in `src/scripts/registry.ts`.
7. Update `src/workers/scriptRunner.worker.ts` to route the new script ID.
8. Update the UI if the new script requires a different input shape.

The first screen is already a script selector. `App.tsx` still assumes the URL Generator input shape after a script is opened, so a script with different inputs should get its own workspace component or a script-specific form.

## Implementation Notes

- Processing is client-side only.
- The 5 MB file limit is defined in `src/scripts/urlGenerator/types.ts`.
- Header matching is intentionally forgiving. It normalizes case, accents, punctuation, separators, and common symbols like `#`.
- Header rows are scanned near the top of the sheet, so exported workbooks with a title row above the actual headers should still work.
- If no headers are detected, data starts at row 1 and positional fallback columns are used.
- Rows missing required values are skipped and reported in `input_issues`.
- Product matching is case-insensitive and ignores spaces, dots, underscores, and hyphens.
- Duplicate EAN rows are skipped by product, EAN, and SKU.
- Only the first non-empty worksheet in each workbook is currently processed.

## Known Limitations

- `.xls`, `.csv`, and macro-enabled `.xlsm` files are not supported.
- Only one worksheet per workbook is processed.
- Advanced Excel features such as macros, pivot tables, formulas, and charts are not preserved from source files.
- The URL Generator output is a new workbook, not a modified copy of either input workbook.
- The current script workspace is designed around URL Generator's two-workbook input shape. More scripts may need per-script input forms.

## Troubleshooting

If dependencies are missing:

```sh
npm install
```

If the dev server port is busy:

```sh
npm run dev
```

Then use the URL printed by Vite.

If TypeScript or bundling fails:

```sh
npm run build
```

Read the first TypeScript error first. The app uses strict TypeScript settings, so unused variables and type drift are caught during build.

If transform behavior changes:

```sh
npm test
```

Add or update tests in:

- `src/scripts/urlGenerator/transform.test.ts`
- `src/scripts/urlGenerator/excel.test.ts`

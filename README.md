# Open Commander

Open Commander is a Cloudflare-hosted web app for running small Excel-processing scripts in the user's browser. The current deployment uses Workers static assets through Wrangler. The app does not upload source workbooks to a backend, does not store files, and does not require server-side compute for the current workflow.

The first script is **URL Generator**. It takes one orders workbook and one EAN/UPC workbook, matches rows by product, and produces a downloadable `.xlsx` output with generated URLs.

## Stack

- Vite
- React
- TypeScript
- ExcelJS
- Web Workers
- Vitest
- Cloudflare Workers static assets

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
- required-header failures when no recognizable header row exists
- skipped incomplete rows
- duplicate purchase order/product, EAN, and SKU validation
- workbook read/write behavior through ExcelJS

## Cloudflare Deployment

If the Cloudflare project uses Workers Builds and requires a deploy command, use:

```text
Build command: npm run build
Deploy command: npm run deploy
Non-production branch deploy command: npm run deploy:preview
Root directory: /
```

`wrangler.jsonc` configures the deployment as Workers static assets from `dist` with single-page app fallback. There is still no server route, database, object storage, KV namespace, or custom Worker API required for the current app.

The generated `dist` folder is static assets only. The Excel processing code is bundled into a browser Web Worker.

For a manual Workers static-assets deployment from a local machine or external CI, run:

```sh
npm run deploy:worker
```

If you are using a classic Cloudflare Pages Git project that does not require a deploy command, the Pages settings are:

```text
Build command: npm run build
Build output directory: dist
Root directory: /
```

For a manual Pages direct upload, run:

```sh
npm run deploy:pages
```

That command builds the app and uploads `dist` with `wrangler pages deploy`.

## User Workflow

1. Open the app.
2. Choose a script from the script selector.
3. Drop or select `.xlsx` files.
4. Choose one orders workbook and one EAN/UPC workbook.
5. Run the script.
6. Review the run summary and generated-row preview.
7. Download the generated output workbook.

The app enforces a 5 MB maximum per file. Files are read locally with browser APIs and normally processed in a Web Worker. The output panel shows progress stages while the run is active. If the browser stops background processing, the app rereads the selected files and retries once. If the retry also fails with a runtime processing failure, the UI offers compatibility mode, which runs the same script on the main browser thread. Validation failures, such as missing headers, invalid identifier modes, or duplicate purchase order/product combinations, are shown as input issues and are not retried. The URL Generator workspace also includes small downloadable orders and EAN/UPC workbook templates.

## URL Generator Input

The current script expects two workbooks:

- Orders workbook
- EAN/UPC workbook

File names are auto-detected when possible:

- `*_orders.xlsx` is treated as orders.
- `*_eans.xlsx` is treated as the EAN/UPC workbook.
- Names containing UPC, barcode, GTIN, or identifier terms are also treated as the EAN/UPC workbook.

The UI still lets the user manually choose which file is which.

### Orders Columns

Required fields:

- `purchase_order`
- `product`
- `base_url`

One purchase order may contain multiple products. Each normalized `purchase_order` + `product` combination may appear once; duplicate combinations are rejected.

Accepted header examples include:

- Purchase order: `purchase_order`, `purchase order`, `purchase order number`, `po`, `po number`, `order`, `order number`, `batch`, `batch number`
- Product: `product`, `product code`, `product_code`, `product number`, `item`, `item code`, `item number`, `article`, `article number`, `style`, `style number`
- Base URL: `base_url`, `base url`, `url`, `link`, `web link`, `base link`, `website`

If no recognizable header row is detected, the run fails with input issues. The script no longer falls back to positional columns.

### EAN/UPC Columns

Required fields:

- `product`

Identifier fields:

- `ean`
- `upc`
- `mode`

Optional field:

- `sku`

Accepted header examples include:

- Product: `product`, `product code`, `product_code`, `product number`, `item`, `item code`, `item number`, `article`, `article number`, `style`, `style number`
- EAN: `ean`, `eans`, `barcode`, `bar code`
- UPC: `upc`, `upcs`, `upc code`, `upc number`, `universal product code`
- Mode: `mode`, `gtin mode`, `identifier mode`, `url mode`
- SKU: `sku`, `variant sku`, `size sku`, `internal sku`

`gtin` is intentionally not accepted as an identifier header because it is ambiguous once EAN and UPC are handled differently.

Mode values are row-level and may be blank:

- blank mode with EAN present uses EAN
- blank mode with both EAN and UPC present uses EAN
- `ean` uses EAN and requires an EAN value
- `upc` uses UPC and requires both EAN and UPC values
- `upc only` uses UPC and requires a UPC value

If only a UPC column/value is present and mode is blank, the run fails with an input issue saying mode `upc only` is required for UPC-only URLs. If both EAN and UPC values are present with mode `upc only`, the run succeeds and records a warning that EAN is ignored.

If no recognizable header row is detected, the run fails with input issues. Duplicate EAN, duplicate UPC, and duplicate SKU values are rejected.

## URL Generator Output

The generated workbook always includes:

- `urls`
- `summary`

It may also include:

- `unmatched_orders`, when any order product has no matching EAN/UPC product
- `input_issues`, when warnings or informational notices were recorded in an otherwise successful run

The main URL format is:

```text
{base_url}/01/{identifier}/10/{purchase_order}
```

The script trims trailing slashes from `base_url` and URL-encodes the chosen identifier and purchase order path segments.
`base_url` values must be valid `https://` root domains, such as `https://example.com`. They must not include paths, query strings, hashes, credentials, `http://`, or `www.`. Template placeholder domains such as `example.com` are rejected in uploaded data so they are not accidentally reused in output.

For each valid order row, the script finds all EAN/UPC rows for the same normalized product and creates one URL row per matching identifier row. Product matching is case-insensitive and ignores spaces, dots, underscores, and hyphens.

The `urls` sheet includes `identifier_type`, `identifier`, `ean`, `upc`, `mode`, `order_row_number`, and `identifier_row_number` columns so output rows can be traced back to the source workbooks. `unmatched_orders` includes `order_row_number`.

After a successful run, the UI shows:

- a plain-language summary of URLs created, source rows read, and unmatched orders
- count cards for URLs, orders, EAN/UPC rows, and unmatched orders
- a preview of the first five generated URL rows
- detected source-table/header information
- any non-fatal issues included in the output workbook

## Project Structure

```text
public/
  _headers
  templates/
    url-generator-orders-template.xlsx
    url-generator-eans-template.xlsx

src/
  app/
    App.tsx
    runInWorker.ts

  lib/
    download.ts
    file.ts
    id.ts

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
- `src/lib/download.ts`: Blob download helper for generated output workbooks.
- `src/lib/file.ts`: browser file-reading helper.
- `src/lib/id.ts`: local ID helper for selected files and notices.
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
  -> user confirms orders and EAN/UPC files
  -> App reads File objects as ArrayBuffer
  -> runInWorker posts buffers to scriptRunner.worker
  -> worker reports progress stages and dynamically loads the Excel engine
  -> worker calls runUrlGenerator
  -> ExcelJS reads both workbooks
  -> transform logic extracts records and builds URLs
  -> ExcelJS writes the output workbook
  -> worker returns ArrayBuffer to UI
  -> UI shows summary, first-row preview, detected headers, and download action
  -> UI creates a Blob download when the user clicks Download
```

The worker reports progress stages as it starts, loads ExcelJS, reads each workbook, builds URLs, and writes the output workbook. If background processing stops unexpectedly, the UI rereads the selected files and retries once. If the retry fails with a runtime processing failure, the UI offers compatibility mode. Validation failures, such as missing headers or duplicate purchase order/product combinations, are shown as input issues and are not retried.

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
- Successful run results include `previewRows`, currently the first five generated URL rows, for UI preview only. The full output remains in the generated workbook.
- Header matching is intentionally forgiving. It normalizes case, accents, punctuation, separators, and common symbols like `#`.
- Header rows are scanned near the top of the sheet, so exported workbooks with a title row above the actual headers should still work.
- If no headers are detected, the run fails with input issues. There is no positional fallback.
- If a header row is detected, missing required columns are reported as input issues.
- Rows missing required values are skipped during extraction and reported as fatal input issues, so no output workbook is created until they are fixed.
- Product matching is case-insensitive and ignores spaces, dots, underscores, and hyphens.
- Purchase order/product combinations must be unique. Purchase orders are normalized by trimming and uppercasing; products use the same normalization as product matching.
- Duplicate EAN, UPC, and SKU values are reported as fatal input issues.
- EAN and UPC values are checked for non-numeric characters and unusual lengths.
- Simple zero-padded numeric formats, such as `0000000000000`, are preserved when ExcelJS exposes the number format.
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

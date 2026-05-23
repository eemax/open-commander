# Open Commander

Open Commander is a browser-only Excel script runner. It is hosted as static assets on Cloudflare and runs workbook processing locally in the user's browser.

There is no backend, database, file storage, or upload step for the current workflow. Source workbooks stay on the user's machine, and the generated workbook is created in the browser.

The only implemented script today is **URL Generator**. It takes one orders workbook and one EAN/UPC workbook, matches rows by product, and creates a downloadable `.xlsx` workbook with generated URLs.

## Quick Start

```sh
npm install
npm run dev
```

The dev server normally runs at:

```text
http://127.0.0.1:5173/
```

Vite prints the actual URL if port `5173` is busy.

Useful commands:

```sh
npm test
npm run build
npm run preview
npm run deploy
```

Recommended local versions:

- Node.js 24 or newer
- npm 11 or newer

## URL Generator

URL Generator expects two `.xlsx` workbooks:

- **Orders workbook**: purchase orders, products, and base URLs.
- **EAN/UPC workbook**: products, identifiers, optional mode, and optional SKU.

It writes one output workbook. For every valid order row, it finds all matching EAN/UPC rows by normalized product and creates one URL row per matching identifier.

Generated URLs use this format:

```text
{base_url}/01/{identifier}/10/{purchase_order}
```

The chosen identifier and purchase order are URL path encoded. Product matching is case-insensitive and ignores spaces, dots, underscores, and hyphens.

## User Workflow

1. Open the app.
2. Choose URL Generator.
3. Drop or select `.xlsx` files.
4. Confirm which file is orders and which file is EAN/UPC.
5. Run the script.
6. Review the summary, first five generated rows, detected headers, and any non-fatal issues.
7. Download the output workbook.

The app enforces a 5 MB limit per file.

## Input Workbooks

File roles are auto-detected when possible:

- Names containing `orders`, `purchase order`, or `po` are treated as orders.
- Names containing `ean`, `upc`, `barcode`, `gtin`, or `identifier` terms are treated as EAN/UPC.

The UI still lets the user manually choose each role.

### Orders Workbook

Required columns:

| Field | Accepted header examples |
| --- | --- |
| `purchase_order` | `purchase_order`, `purchase order`, `purchase order number`, `po`, `po number`, `order`, `order number`, `batch`, `batch number` |
| `product` | `product`, `product code`, `product_code`, `product number`, `item`, `item code`, `item number`, `article`, `article number`, `style`, `style number` |
| `base_url` | `base_url`, `base url`, `url`, `link`, `web link`, `base link`, `website` |

One purchase order may contain multiple products. The normalized `purchase_order` + `product` combination must be unique.

### EAN/UPC Workbook

Required column:

| Field | Accepted header examples |
| --- | --- |
| `product` | `product`, `product code`, `product_code`, `product number`, `item`, `item code`, `item number`, `article`, `article number`, `style`, `style number` |

Identifier and optional columns:

| Field | Accepted header examples | Notes |
| --- | --- | --- |
| `ean` | `ean`, `eans`, `barcode`, `bar code` | Used by default when present. |
| `upc` | `upc`, `upcs`, `upc code`, `upc number`, `universal product code` | Used only when mode explicitly selects UPC behavior. |
| `mode` | `mode`, `gtin mode`, `identifier mode`, `url mode` | Row-level mode. May be blank. |
| `sku` | `sku`, `variant sku`, `size sku`, `internal sku` | Optional output trace field. |

`gtin` is intentionally not accepted as an identifier header because it is ambiguous once EAN and UPC can behave differently.

### EAN/UPC Modes

EAN is the default. UPC behavior must be explicit when UPC-only URLs are needed.

| EAN value | UPC value | Mode | Result |
| --- | --- | --- | --- |
| present | blank | blank | Generate EAN URL. |
| present | present | blank | Generate EAN URL. |
| present | any | `ean` | Generate EAN URL. |
| present | present | `upc` | Generate UPC URL. |
| blank | present | blank | Fail. Mode `upc only` is required. |
| blank | present | `upc only` | Generate UPC URL. |
| present | present | `upc only` | Generate UPC URL and warn that EAN is ignored. |
| missing | missing | any | Fail. Either EAN or UPC is required. |

`upc` mode requires both EAN and UPC values. `upc only` mode requires a UPC value.

### Base URL Rules

Base URLs must be HTTPS root domains in the same shape as:

```text
https://id.example.com
```

Uploaded data must replace that template value. The placeholder domain `id.example.com` is rejected so it cannot accidentally ship in output.

Base URLs must not include:

- `http://`
- `www.`
- paths such as `/product`
- query strings
- hashes
- usernames or passwords
- the `id.example.com` template placeholder

Trailing slashes are allowed and are removed in output.

## Validation Behavior

The script detects a likely header row near the top of each workbook. Exported sheets with a title row above the real headers should still work.

If no recognizable header row is found, the run fails with input issues. The script does not fall back to positional columns.

Fatal input issues stop the run before an output workbook is created. Examples include:

- missing required columns
- empty required cells
- duplicate purchase order/product combinations
- duplicate EAN, UPC, or SKU values
- invalid EAN/UPC mode combinations
- invalid Base URLs

Non-fatal issues are written to the output workbook when the run can still complete. Examples include:

- EAN or UPC values with non-numeric characters
- EAN or UPC values with unusual lengths
- `upc only` rows that also include an EAN value

Validation failures are separate from runtime failures. They are shown as input issues and do not trigger retry or compatibility mode.

## Output Workbook

The generated workbook always includes:

- `urls`
- `summary`

It may also include:

- `unmatched_orders`, when an order product has no matching EAN/UPC product
- `input_issues`, when warnings or informational issues were recorded in a successful run

The `urls` sheet includes:

- `purchase_order`
- `product`
- `sku`
- `identifier_type`
- `identifier`
- `ean`
- `upc`
- `mode`
- `base_url`
- `url`
- `order_row_number`
- `identifier_row_number`

The UI also exposes `previewRows`, which are the first five generated URL rows.

## Architecture

Open Commander is a Vite, React, and TypeScript app. Excel processing uses ExcelJS.

At runtime:

```text
React UI
  -> reads selected File objects as ArrayBuffer
  -> sends buffers to a browser Web Worker
  -> worker dynamically loads the Excel engine
  -> runUrlGenerator reads workbooks with ExcelJS
  -> pure transform logic validates records and builds URLs
  -> ExcelJS writes the output workbook
  -> worker returns the output ArrayBuffer
  -> UI shows summary, preview, issues, and download action
```

Processing normally happens in a Web Worker. If browser background processing stops unexpectedly, the UI rereads the selected files and retries once. If the retry also fails with a runtime processing failure, the user can run compatibility mode on the main browser thread.

Core files:

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
public/templates/*.xlsx
```

## Adding Scripts

The first screen is already a generic script selector, but the opened workspace currently assumes URL Generator's two-workbook input shape.

For a new script:

1. Add a folder under `src/scripts/<scriptName>/`.
2. Keep business logic pure and testable outside ExcelJS.
3. Keep workbook IO in a script-specific Excel module.
4. Register script metadata in `src/scripts/registry.ts`.
5. Route the script in `src/workers/scriptRunner.worker.ts`.
6. Add transform tests and workbook-level tests where useful.
7. Add a script-specific workspace component if the input shape differs from URL Generator.

## Deployment

The current Cloudflare setup uses Workers static assets through Wrangler.

Cloudflare build settings:

```text
Build command: npm run build
Deploy command: npm run deploy
Non-production branch deploy command: npm run deploy:preview
Root directory: /
```

`wrangler.jsonc` serves `dist` as static assets with single-page app fallback. No Cloudflare bindings are required.

Manual Workers deployment:

```sh
npm run deploy:worker
```

For a classic Cloudflare Pages project:

```text
Build command: npm run build
Build output directory: dist
Root directory: /
```

Manual Pages direct upload:

```sh
npm run deploy:pages
```

## Known Limitations

- Only `.xlsx` files are supported.
- Only the first non-empty worksheet in each workbook is processed.
- Source workbook macros, pivot tables, formulas, charts, and formatting are not preserved.
- The output is a new workbook, not a modified copy of either input workbook.
- ExcelJS browser bundles are large; watch build output when adding dependencies.

## Troubleshooting

Install missing dependencies:

```sh
npm install
```

Run tests:

```sh
npm test
```

Build and type-check:

```sh
npm run build
```

Start local development:

```sh
npm run dev
```

If Vite chooses a different port, use the URL printed in the terminal.

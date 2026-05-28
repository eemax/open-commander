# Open Commander

Open Commander is a browser-only Excel script runner. It is hosted as static assets on Cloudflare Workers and processes workbooks locally in the user's browser.

There is no backend, database, file storage, or upload step in the current product. Source workbooks stay on the user's machine. The generated workbook is created in the browser and downloaded from the page.

The only implemented script is **URL Generator**. It takes one orders workbook and one EAN/UPC workbook, matches rows by product, and creates a downloadable `.xlsx` workbook with generated URLs.

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

- **Orders workbook**: purchase orders, products, and Base URLs.
- **EAN/UPC workbook**: products, identifiers, optional mode, and optional SKU.

For every valid order row, the script finds all matching EAN/UPC rows by normalized product and creates one URL row per matching identifier.

Generated URL shape:

```text
{base_url}/01/{identifier}/10/{purchase_order}
```

The identifier and purchase order are URL path encoded. Product matching is case-insensitive and ignores spaces, dots, underscores, and hyphens.

## User Workflow

1. Open the app.
2. Choose URL Generator.
3. Drop or select `.xlsx` files.
4. Confirm which file is orders and which file is EAN/UPC.
5. Run the script.
6. Review the summary, preview rows, detected headers, and any issues.
7. Download the output workbook.

The URL Generator screen includes a Help button with short guidance for columns, modes, and Base URLs.

The app enforces a 5 MB limit per file.

## File Role Detection

File roles are auto-detected when possible:

- Names containing `orders`, `purchase order`, or `po` are treated as orders.
- Names containing EAN/UPC, barcode, GTIN, or identifier terms are treated as EAN/UPC.

The UI still lets the user manually choose each role.

## Orders Workbook

Required columns:

| Field | Accepted header examples |
| --- | --- |
| `purchase_order` | `purchase_order`, `purchase order`, `purchase order number`, `po`, `po number`, `order`, `order number`, `batch`, `batch number` |
| `product` | `product`, `product code`, `product number`, `item`, `item code`, `item number`, `article`, `article number`, `style`, `style number` |
| `base_url` | `base_url`, `base url`, `url`, `link`, `web link`, `base link`, `website` |

One purchase order may contain multiple products. The normalized `purchase_order` plus `product` combination must be unique.

## EAN/UPC Workbook

Required column:

| Field | Accepted header examples |
| --- | --- |
| `product` | `product`, `product code`, `product number`, `item`, `item code`, `item number`, `article`, `article number`, `style`, `style number` |

Identifier and optional columns:

| Field | Accepted header examples | Notes |
| --- | --- | --- |
| `ean` | `ean`, `eans`, `barcode`, `bar code` | Used by default when present. |
| `upc` | `upc`, `upcs`, `upc code`, `upc number`, `universal product code` | Used only when mode selects UPC behavior. |
| `mode` | `mode`, `gtin mode`, `identifier mode`, `url mode` | Row-level identifier mode. May be blank. |
| `sku` | `sku`, `variant sku`, `size sku`, `internal sku` | Optional output trace field. |

`gtin` is intentionally not accepted as an identifier header because it is ambiguous once EAN and UPC can behave differently.

## EAN/UPC Modes

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

## Base URL Rules

Base URLs must be HTTPS root domains in this shape:

```text
https://brand.example.com
```

Base URLs must not include:

- `http://`
- `www.`
- paths such as `/product`
- query strings
- hashes
- usernames or passwords
- the template placeholder `https://id.example.com`

Trailing slashes are allowed and removed in output.

The downloadable orders template uses `https://id.example.com` as a placeholder. Uploaded workbooks must replace it; the app rejects that exact placeholder domain to prevent accidental production output.

## Validation Behavior

The script detects likely header rows near the top of each workbook. Exported sheets with title rows above the actual headers should still work.

If no recognizable header row is found, the run fails with input issues. The script does not fall back to positional columns.

Fatal input issues stop the run before an output workbook is created. Examples include:

- missing required columns
- empty required cells
- duplicate purchase order/product combinations
- duplicate EAN, UPC, or SKU values
- invalid EAN/UPC mode combinations
- invalid Base URLs

When a validation run fails, the UI shows up to the first 50 input errors from the current pass. Base URL errors are collected with the orders workbook even when the EAN/UPC workbook also has fatal validation errors.

Non-fatal issues are written to the output workbook when the run can still complete. Examples include:

- EAN or UPC values with non-numeric characters
- EAN or UPC values with unusual lengths
- `upc only` rows that also include an EAN value

Validation failures are separate from runtime failures. Validation failures show row-level fixes and do not trigger retry or compatibility mode.

## Output Workbook

Successful runs always write:

- `urls`
- `summary`

Successful runs may also write:

- `unmatched_orders`, when an order product has no matching EAN/UPC product
- `input_issues`, when warnings or informational issues were recorded

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

The UI preview shows the first five generated URL rows.

## Runtime Model

Processing normally happens in a browser Web Worker:

```text
React UI
  -> reads selected File objects as ArrayBuffer
  -> sends buffers to a browser Web Worker
  -> worker dynamically loads the Excel engine
  -> ExcelJS reads workbook rows
  -> pure transform logic validates records and builds URLs
  -> ExcelJS writes the output workbook
  -> worker returns the output ArrayBuffer
  -> UI shows summary, preview, issues, and download action
```

If worker processing fails for a runtime reason, the UI rereads the selected files and retries once. If the retry also fails, the user can run compatibility mode on the main browser thread. Input validation failures do not retry.

## Project Structure

```text
src/app/
  App.tsx
  ScriptSelector.tsx
  ThemeModeControl.tsx
  UrlGeneratorHelpModal.tsx
  RunProgress.tsx
  RunFailureView.tsx
  ResultView.tsx
  runInWorker.ts

src/scripts/
  registry.ts
  urlGenerator/
    baseUrl.ts
    excel.ts
    transform.ts
    headers.ts
    fileRoles.ts
    types.ts
    *.test.ts

src/styles.css
src/styles/*.css
public/templates/*.xlsx
```

## Design And Theme

Open Commander supports auto, light, and dark themes. Auto follows the OS/browser color scheme. The design uses semantic colors:

- blue for runnable system affordances
- yellow ocher for the run moment
- green for success
- amber for warnings
- red for fatal errors
- neutral white/gray for ordinary UI

See [docs/design-palette.md](docs/design-palette.md) for theme tokens and color rules.

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

Cloudflare Workers serves the built static assets from `dist`.

```sh
npm run build
npm run deploy
```

`wrangler.jsonc` uses `assets.directory = "./dist"` with single-page application fallback. No bindings are required for the current product.

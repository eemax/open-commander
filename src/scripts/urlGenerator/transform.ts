import {
  detectTableLayout,
  isMissingText,
  normalizeDataText,
  normalizeProductKey,
  type ColumnSpec,
} from "./headers";
import type {
  DetectedTable,
  EanRecord,
  FileRole,
  OrderRecord,
  ProcessingIssue,
  UnmatchedOrderRow,
  UrlOutputRow,
} from "./types";

type OrderField = "purchase_order" | "product" | "base_url";
type EanField = "product" | "ean" | "sku";

type FileContext = {
  fileRole: FileRole;
  fileName: string;
  sheetName: string;
};

export type ExtractedOrders = {
  records: OrderRecord[];
  issues: ProcessingIssue[];
  detectedTable: DetectedTable;
};

export type ExtractedEans = {
  records: EanRecord[];
  issues: ProcessingIssue[];
  detectedTable: DetectedTable;
};

export type BuiltUrlOutput = {
  urls: UrlOutputRow[];
  unmatchedOrders: UnmatchedOrderRow[];
  issues: ProcessingIssue[];
};

const ORDER_COLUMNS: ColumnSpec<OrderField>[] = [
  {
    key: "purchase_order",
    label: "Purchase order",
    aliases: [
      "purchase_order",
      "purchase order",
      "purchase order number",
      "po",
      "po number",
      "order",
      "order number",
    ],
    fallbackIndex: 0,
    required: true,
  },
  {
    key: "product",
    label: "Product",
    aliases: [
      "product",
      "product code",
      "product_code",
      "item",
      "item code",
      "article",
      "article number",
      "style",
      "sku",
    ],
    fallbackIndex: 1,
    required: true,
  },
  {
    key: "base_url",
    label: "Base URL",
    aliases: ["base_url", "base url", "url", "link", "web link", "base link"],
    fallbackIndex: 2,
    required: true,
  },
];

const EAN_COLUMNS: ColumnSpec<EanField>[] = [
  {
    key: "product",
    label: "Product",
    aliases: [
      "product",
      "product code",
      "product_code",
      "item",
      "item code",
      "article",
      "article number",
      "style",
      "sku",
    ],
    fallbackIndex: 0,
    required: true,
  },
  {
    key: "ean",
    label: "EAN",
    aliases: ["ean", "eans", "barcode", "bar code", "gtin", "gtins", "upc"],
    fallbackIndex: 1,
    required: true,
  },
  {
    key: "sku",
    label: "SKU",
    aliases: ["sku", "variant sku", "size sku", "internal sku"],
    fallbackIndex: 2,
    required: false,
  },
];

export function extractOrders(
  rows: string[][],
  context: FileContext,
): ExtractedOrders {
  const { records, issues, detectedTable } = extractRecords<OrderField>(
    rows,
    ORDER_COLUMNS,
    context,
  );

  return {
    records: records.map(({ values, sourceRowNumber }) => ({
      purchase_order: values.purchase_order,
      product: values.product,
      base_url: values.base_url,
      sourceRowNumber,
    })),
    issues,
    detectedTable,
  };
}

export function extractEans(rows: string[][], context: FileContext): ExtractedEans {
  const { records, issues, detectedTable } = extractRecords<EanField>(
    rows,
    EAN_COLUMNS,
    context,
  );

  return {
    records: records.map(({ values, sourceRowNumber }) => ({
      product: values.product,
      ean: values.ean,
      sku: values.sku ?? "",
      sourceRowNumber,
    })),
    issues,
    detectedTable,
  };
}

export function buildUrls(
  orders: OrderRecord[],
  eans: EanRecord[],
): BuiltUrlOutput {
  const issues: ProcessingIssue[] = [];
  const eansByProduct = new Map<string, EanRecord[]>();
  const seenEans = new Set<string>();
  let duplicateEanRows = 0;

  for (const eanRecord of eans) {
    const productKey = normalizeProductKey(eanRecord.product);
    const eanKey = `${productKey}\u0000${eanRecord.ean}\u0000${eanRecord.sku}`;

    if (seenEans.has(eanKey)) {
      duplicateEanRows += 1;
      continue;
    }

    seenEans.add(eanKey);

    const bucket = eansByProduct.get(productKey) ?? [];
    bucket.push(eanRecord);
    eansByProduct.set(productKey, bucket);
  }

  if (duplicateEanRows > 0) {
    issues.push({
      severity: "info",
      fileRole: "eans",
      message: `${duplicateEanRows} duplicate EAN row${
        duplicateEanRows === 1 ? "" : "s"
      } skipped.`,
    });
  }

  const urls: UrlOutputRow[] = [];
  const unmatchedOrders: UnmatchedOrderRow[] = [];
  const unmatchedKeys = new Set<string>();

  for (const order of orders) {
    const matches = eansByProduct.get(normalizeProductKey(order.product));

    if (!matches || matches.length === 0) {
      const unmatchedKey = `${order.purchase_order}\u0000${order.product}\u0000${order.base_url}`;
      if (!unmatchedKeys.has(unmatchedKey)) {
        unmatchedOrders.push({
          purchase_order: order.purchase_order,
          product: order.product,
          base_url: normalizeBaseUrl(order.base_url),
        });
        unmatchedKeys.add(unmatchedKey);
      }
      continue;
    }

    for (const match of matches) {
      const baseUrl = normalizeBaseUrl(order.base_url);
      urls.push({
        purchase_order: order.purchase_order,
        product: order.product,
        base_url: baseUrl,
        ean: match.ean,
        sku: match.sku,
        url: `${baseUrl}/01/${encodeURIComponent(match.ean)}/10/${encodeURIComponent(
          order.purchase_order,
        )}`,
      });
    }
  }

  if (urls.length === 0) {
    issues.push({
      severity: "warning",
      message: "No URLs were created because no order products matched EAN products.",
    });
  }

  return {
    urls: sortUrlRows(urls),
    unmatchedOrders: sortUnmatchedRows(unmatchedOrders),
    issues,
  };
}

function extractRecords<TKey extends string>(
  rows: string[][],
  specs: ColumnSpec<TKey>[],
  context: FileContext,
): {
  records: { values: Record<TKey, string>; sourceRowNumber: number }[];
  issues: ProcessingIssue[];
  detectedTable: DetectedTable;
} {
  const layout = detectTableLayout(rows, specs);
  const issues = layout.issues.map((issue) => withContext(issue, context));
  const records: { values: Record<TKey, string>; sourceRowNumber: number }[] = [];
  const requiredSpecs = specs.filter((spec) => spec.required);

  for (let rowIndex = layout.dataStartIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];

    if (row.every((value) => isMissingText(value))) {
      continue;
    }

    const values = {} as Record<TKey, string>;
    let hasMissingRequired = false;

    for (const spec of specs) {
      const column = layout.columns.get(spec.key);
      const value = column ? normalizeDataText(row[column.columnIndex] ?? "") : "";
      values[spec.key] = value;
    }

    for (const spec of requiredSpecs) {
      if (isMissingText(values[spec.key])) {
        hasMissingRequired = true;
        issues.push(
          withContext(
            {
              severity: "warning",
              rowNumber: rowIndex + 1,
              field: spec.key,
              message: `Skipped row because "${spec.label}" is empty.`,
            },
            context,
          ),
        );
      }
    }

    if (!hasMissingRequired) {
      records.push({ values, sourceRowNumber: rowIndex + 1 });
    }
  }

  if (records.length === 0) {
    issues.push(
      withContext(
        {
          severity: "error",
          message: "No usable data rows were found.",
        },
        context,
      ),
    );
  }

  return {
    records,
    issues,
    detectedTable: {
      fileRole: context.fileRole,
      fileName: context.fileName,
      sheetName: context.sheetName,
      headerRowNumber:
        layout.headerRowIndex === null ? null : layout.headerRowIndex + 1,
      dataStartRowNumber: layout.dataStartIndex + 1,
      columns: [...layout.columns.values()],
    },
  };
}

function withContext(
  issue: ProcessingIssue,
  context: FileContext,
): ProcessingIssue {
  return {
    ...issue,
    fileRole: issue.fileRole ?? context.fileRole,
    fileName: issue.fileName ?? context.fileName,
    sheetName: issue.sheetName ?? context.sheetName,
  };
}

function normalizeBaseUrl(url: string): string {
  return normalizeDataText(url).replace(/\/+$/g, "");
}

function sortUrlRows(rows: UrlOutputRow[]): UrlOutputRow[] {
  return [...rows].sort((a, b) =>
    [
      a.product.localeCompare(b.product, undefined, { numeric: true }),
      a.purchase_order.localeCompare(b.purchase_order, undefined, {
        numeric: true,
      }),
      a.ean.localeCompare(b.ean, undefined, { numeric: true }),
    ].find((result) => result !== 0) ?? 0,
  );
}

function sortUnmatchedRows(rows: UnmatchedOrderRow[]): UnmatchedOrderRow[] {
  return [...rows].sort((a, b) =>
    [
      a.product.localeCompare(b.product, undefined, { numeric: true }),
      a.purchase_order.localeCompare(b.purchase_order, undefined, {
        numeric: true,
      }),
    ].find((result) => result !== 0) ?? 0,
  );
}

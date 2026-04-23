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
  const orderRecords = records.map(({ values, sourceRowNumber }) => ({
    purchase_order: values.purchase_order,
    product: values.product,
    base_url: values.base_url,
    sourceRowNumber,
  }));

  return {
    records: orderRecords,
    issues: [...issues, ...validateDuplicateOrders(orderRecords, context)],
    detectedTable,
  };
}

export function extractEans(rows: string[][], context: FileContext): ExtractedEans {
  const { records, issues, detectedTable } = extractRecords<EanField>(
    rows,
    EAN_COLUMNS,
    context,
  );
  const eanRecords = records.map(({ values, sourceRowNumber }) => ({
    product: values.product,
    ean: values.ean,
    sku: values.sku ?? "",
    sourceRowNumber,
  }));

  return {
    records: eanRecords,
    issues: [
      ...issues,
      ...eanRecords.flatMap((record) => validateEan(record, context)),
      ...validateDuplicateEans(eanRecords, context),
    ],
    detectedTable,
  };
}

export function buildUrls(
  orders: OrderRecord[],
  eans: EanRecord[],
): BuiltUrlOutput {
  const issues: ProcessingIssue[] = [];
  const uniqueOrders: OrderRecord[] = [];
  const seenOrders = new Set<string>();
  const eansByProduct = new Map<string, EanRecord[]>();
  const seenEans = new Set<string>();
  const seenSkus = new Set<string>();

  for (const order of orders) {
    const orderKey = normalizeIdentifierKey(order.purchase_order);

    if (seenOrders.has(orderKey)) {
      issues.push({
        severity: "error",
        fileRole: "orders",
        rowNumber: order.sourceRowNumber,
        field: "purchase_order",
        message: `Duplicate purchase order "${order.purchase_order}" skipped.`,
      });
      continue;
    }

    seenOrders.add(orderKey);
    uniqueOrders.push(order);
  }

  for (const eanRecord of eans) {
    const productKey = normalizeProductKey(eanRecord.product);
    const eanKey = normalizeIdentifierKey(eanRecord.ean);
    const skuKey = normalizeIdentifierKey(eanRecord.sku);
    let hasDuplicateIdentifier = false;

    if (seenEans.has(eanKey)) {
      hasDuplicateIdentifier = true;
      issues.push({
        severity: "error",
        fileRole: "eans",
        rowNumber: eanRecord.sourceRowNumber,
        field: "ean",
        message: `Duplicate EAN "${eanRecord.ean}" skipped.`,
      });
    }

    if (skuKey && seenSkus.has(skuKey)) {
      hasDuplicateIdentifier = true;
      issues.push({
        severity: "error",
        fileRole: "eans",
        rowNumber: eanRecord.sourceRowNumber,
        field: "sku",
        message: `Duplicate SKU "${eanRecord.sku}" skipped.`,
      });
    }

    if (hasDuplicateIdentifier) {
      continue;
    }

    seenEans.add(eanKey);

    if (skuKey) {
      seenSkus.add(skuKey);
    }

    const bucket = eansByProduct.get(productKey) ?? [];
    bucket.push(eanRecord);
    eansByProduct.set(productKey, bucket);
  }

  const urls: UrlOutputRow[] = [];
  const unmatchedOrders: UnmatchedOrderRow[] = [];
  const unmatchedKeys = new Set<string>();
  const invalidOrders = new Set<OrderRecord>();
  const baseUrlsByOrder = new Map<OrderRecord, string>();
  let matchedOrderCount = 0;

  for (const order of uniqueOrders) {
    const baseUrlResult = parseBaseUrl(order);

    if (!baseUrlResult.ok) {
      invalidOrders.add(order);
      issues.push(baseUrlResult.issue);
      continue;
    }

    baseUrlsByOrder.set(order, baseUrlResult.baseUrl);
    issues.push(...baseUrlResult.issues);
  }

  for (const order of uniqueOrders) {
    const matches = eansByProduct.get(normalizeProductKey(order.product));

    if (invalidOrders.has(order)) {
      if (matches && matches.length > 0) {
        matchedOrderCount += 1;
      }
      continue;
    }

    if (!matches || matches.length === 0) {
      const unmatchedKey = `${order.purchase_order}\u0000${order.product}\u0000${order.base_url}`;
      if (!unmatchedKeys.has(unmatchedKey)) {
        unmatchedOrders.push({
          order_row_number: order.sourceRowNumber,
          purchase_order: order.purchase_order,
          product: order.product,
          base_url: normalizeBaseUrl(order.base_url),
        });
        unmatchedKeys.add(unmatchedKey);
      }
      continue;
    }

    matchedOrderCount += 1;
    const baseUrl = baseUrlsByOrder.get(order) ?? normalizeBaseUrl(order.base_url);

    for (const match of matches) {
      urls.push({
        order_row_number: order.sourceRowNumber,
        ean_row_number: match.sourceRowNumber,
        purchase_order: order.purchase_order,
        product: order.product,
        base_url: baseUrl,
        ean: match.ean,
        sku: match.sku,
        url: formatGeneratedUrl(baseUrl, match.ean, order.purchase_order),
      });
    }
  }

  const sortedUrls = sortUrlRows(urls);

  if (urls.length === 0) {
    issues.push({
      severity: "warning",
      message:
        matchedOrderCount > 0
          ? "No URLs were created because matching orders had invalid Base URLs."
          : "No URLs were created because no order products matched EAN products.",
    });
  }

  return {
    urls: sortedUrls,
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
  const missingRequiredColumns = new Set(
    requiredSpecs
      .filter((spec) => !layout.columns.has(spec.key))
      .map((spec) => spec.key),
  );

  for (let rowIndex = layout.dataStartIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];

    if (row.every((value) => isMissingText(value))) {
      continue;
    }

    const values = {} as Record<TKey, string>;
    let hasMissingRequired = missingRequiredColumns.size > 0;

    for (const spec of specs) {
      const column = layout.columns.get(spec.key);
      const value = column ? normalizeDataText(row[column.columnIndex] ?? "") : "";
      values[spec.key] = value;
    }

    for (const spec of requiredSpecs) {
      if (missingRequiredColumns.has(spec.key)) {
        continue;
      }

      if (isMissingText(values[spec.key])) {
        hasMissingRequired = true;
        issues.push(
          withContext(
            {
              severity: "error",
              rowNumber: rowIndex + 1,
              field: spec.key,
              message: `Mandatory field "${spec.label}" is empty.`,
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

function normalizeIdentifierKey(value: string): string {
  return normalizeDataText(value).toLowerCase();
}

function validateEan(record: EanRecord, context: FileContext): ProcessingIssue[] {
  const issues: ProcessingIssue[] = [];

  if (!/^\d+$/.test(record.ean)) {
    issues.push(
      withContext(
        {
          severity: "warning",
          rowNumber: record.sourceRowNumber,
          field: "ean",
          message: "EAN contains non-numeric characters.",
        },
        context,
      ),
    );
    return issues;
  }

  if (![8, 12, 13, 14].includes(record.ean.length)) {
    issues.push(
      withContext(
        {
          severity: "warning",
          rowNumber: record.sourceRowNumber,
          field: "ean",
          message:
            "EAN length is unusual. If leading zeroes are missing, format the source column as text or with a zero-padding number format.",
        },
        context,
      ),
    );
  }

  return issues;
}

function validateDuplicateOrders(
  records: OrderRecord[],
  context: FileContext,
): ProcessingIssue[] {
  const seenOrders = new Map<string, OrderRecord>();
  const issues: ProcessingIssue[] = [];

  for (const record of records) {
    const key = normalizeIdentifierKey(record.purchase_order);
    const firstRecord = seenOrders.get(key);

    if (firstRecord) {
      issues.push(
        withContext(
          {
            severity: "error",
            rowNumber: record.sourceRowNumber,
            field: "purchase_order",
            message: `Duplicate purchase order "${
              record.purchase_order
            }" also appears on row ${firstRecord.sourceRowNumber}.`,
          },
          context,
        ),
      );
      continue;
    }

    seenOrders.set(key, record);
  }

  return issues;
}

function validateDuplicateEans(
  records: EanRecord[],
  context: FileContext,
): ProcessingIssue[] {
  const seenEans = new Map<string, EanRecord>();
  const seenSkus = new Map<string, EanRecord>();
  const issues: ProcessingIssue[] = [];

  for (const record of records) {
    const eanKey = normalizeIdentifierKey(record.ean);
    const firstEanRecord = seenEans.get(eanKey);

    if (firstEanRecord) {
      issues.push(
        withContext(
          {
            severity: "error",
            rowNumber: record.sourceRowNumber,
            field: "ean",
            message: `Duplicate EAN "${record.ean}" also appears on row ${firstEanRecord.sourceRowNumber}.`,
          },
          context,
        ),
      );
    } else {
      seenEans.set(eanKey, record);
    }

    const skuKey = normalizeIdentifierKey(record.sku);

    if (!skuKey) {
      continue;
    }

    const firstSkuRecord = seenSkus.get(skuKey);

    if (firstSkuRecord) {
      issues.push(
        withContext(
          {
            severity: "error",
            rowNumber: record.sourceRowNumber,
            field: "sku",
            message: `Duplicate SKU "${record.sku}" also appears on row ${firstSkuRecord.sourceRowNumber}.`,
          },
          context,
        ),
      );
      continue;
    }

    seenSkus.set(skuKey, record);
  }

  return issues;
}

function parseBaseUrl(order: OrderRecord):
  | { ok: true; baseUrl: string; issues: ProcessingIssue[] }
  | { ok: false; issue: ProcessingIssue } {
  const rawBaseUrl = normalizeDataText(order.base_url);

  try {
    const parsed = new URL(rawBaseUrl);

    if (parsed.protocol !== "https:") {
      return {
        ok: false,
        issue: {
          severity: "error",
          fileRole: "orders",
          rowNumber: order.sourceRowNumber,
          field: "base_url",
          message: "Base URL must start with https://.",
        },
      };
    }

    if (parsed.username || parsed.password) {
      return {
        ok: false,
        issue: {
          severity: "error",
          fileRole: "orders",
          rowNumber: order.sourceRowNumber,
          field: "base_url",
          message: "Base URL must not include a username or password.",
        },
      };
    }

    if (!isLikelyDomainName(parsed.hostname)) {
      return {
        ok: false,
        issue: {
          severity: "error",
          fileRole: "orders",
          rowNumber: order.sourceRowNumber,
          field: "base_url",
          message: "Base URL must use a domain like example.com.",
        },
      };
    }

    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return {
        ok: false,
        issue: {
          severity: "error",
          fileRole: "orders",
          rowNumber: order.sourceRowNumber,
          field: "base_url",
          message:
            "Base URL must be an https root domain with only an optional trailing slash.",
        },
      };
    }

    const issues: ProcessingIssue[] = [];

    if (parsed.hostname.toLowerCase().startsWith("www.")) {
      issues.push({
        severity: "warning",
        fileRole: "orders",
        rowNumber: order.sourceRowNumber,
        field: "base_url",
        message: "Base URL includes www. Prefer the domain without www.",
      });
    }

    return {
      ok: true,
      baseUrl: serializeBaseUrl(parsed),
      issues,
    };
  } catch {
    return {
      ok: false,
      issue: {
        severity: "error",
        fileRole: "orders",
        rowNumber: order.sourceRowNumber,
        field: "base_url",
        message: "Base URL must be a valid URL like https://example.com.",
      },
    };
  }
}

function serializeBaseUrl(url: URL): string {
  return url.origin;
}

function isLikelyDomainName(hostname: string): boolean {
  const labels = hostname.toLowerCase().split(".");

  if (labels.length < 2) {
    return false;
  }

  return (
    labels.every(isValidDomainLabel) &&
    isValidTopLevelDomain(labels[labels.length - 1])
  );
}

function isValidDomainLabel(label: string | undefined): boolean {
  return Boolean(
    label &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}

function isValidTopLevelDomain(label: string | undefined): boolean {
  return Boolean(
    label &&
      (/^[a-z]{2,63}$/.test(label) ||
        /^xn--[a-z0-9-]{2,59}$/.test(label)),
  );
}

function formatGeneratedUrl(
  baseUrl: string,
  ean: string,
  purchaseOrder: string,
): string {
  return `${baseUrl}/01/${encodeUrlPathSegment(ean)}/10/${encodeUrlPathSegment(
    purchaseOrder,
  )}`;
}

function encodeUrlPathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sortUrlRows(rows: UrlOutputRow[]): UrlOutputRow[] {
  return [...rows].sort((a, b) =>
    [
      compareText(a.purchase_order, b.purchase_order),
      compareText(normalizeProductKey(a.product), normalizeProductKey(b.product)),
      compareText(a.product, b.product),
      compareText(a.sku, b.sku),
      a.ean.localeCompare(b.ean, undefined, { numeric: true }),
    ].find((result) => result !== 0) ?? 0,
  );
}

function sortUnmatchedRows(rows: UnmatchedOrderRow[]): UnmatchedOrderRow[] {
  return [...rows].sort((a, b) =>
    [
      compareText(a.purchase_order, b.purchase_order),
      compareText(normalizeProductKey(a.product), normalizeProductKey(b.product)),
      compareText(a.product, b.product),
      compareText(a.base_url, b.base_url),
    ].find((result) => result !== 0) ?? 0,
  );
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

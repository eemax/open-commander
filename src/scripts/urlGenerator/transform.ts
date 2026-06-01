import {
  detectTableLayout,
  isMissingText,
  normalizeDataText,
  normalizeProductKey,
  type ColumnSpec,
} from "./headers";
import {
  formatGeneratedUrl,
  normalizeBaseUrl,
  parseBaseUrl,
} from "./baseUrl";
import type {
  DetectedTable,
  EanRecord,
  FileRole,
  GtinMode,
  OrderRecord,
  ProcessingIssue,
  UnmatchedOrderRow,
  UrlOutputRow,
} from "./types";

type OrderField = "purchase_order" | "product" | "base_url";
type EanField = "product" | "ean" | "upc" | "mode" | "sku";

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

export const PURCHASE_ORDER_ALIASES = [
  "purchase_order",
  "purchase order",
  "purchase order number",
  "po",
  "po number",
  "order",
  "order number",
  "batch",
  "batch number",
];

export const PRODUCT_ALIASES = [
  "product",
  "product code",
  "product number",
  "item",
  "item code",
  "item number",
  "article",
  "article number",
  "style",
  "style number",
];

export const BASE_URL_ALIASES = [
  "base_url",
  "base url",
  "url",
  "link",
  "web link",
  "base link",
  "website",
];

export const EAN_ALIASES = [
  "ean",
  "eans",
  "barcode",
  "bar code",
];

export const UPC_ALIASES = [
  "upc",
  "upcs",
  "upc code",
  "upc number",
  "universal product code",
];

export const MODE_ALIASES = [
  "mode",
  "gtin mode",
  "identifier mode",
  "url mode",
];

export const SKU_ALIASES = [
  "sku",
  "variant sku",
  "size sku",
  "internal sku",
];

const ORDER_COLUMNS: ColumnSpec<OrderField>[] = [
  {
    key: "purchase_order",
    label: "Purchase order",
    aliases: PURCHASE_ORDER_ALIASES,
    required: true,
  },
  {
    key: "product",
    label: "Product",
    aliases: PRODUCT_ALIASES,
    required: true,
  },
  {
    key: "base_url",
    label: "Base URL",
    aliases: BASE_URL_ALIASES,
    required: true,
  },
];

const EAN_COLUMNS: ColumnSpec<EanField>[] = [
  {
    key: "product",
    label: "Product",
    aliases: PRODUCT_ALIASES,
    required: true,
  },
  {
    key: "ean",
    label: "EAN",
    aliases: EAN_ALIASES,
    required: false,
  },
  {
    key: "upc",
    label: "UPC",
    aliases: UPC_ALIASES,
    required: false,
  },
  {
    key: "mode",
    label: "Mode",
    aliases: MODE_ALIASES,
    required: false,
  },
  {
    key: "sku",
    label: "SKU",
    aliases: SKU_ALIASES,
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
    issues: [
      ...issues,
      ...validateDuplicateOrders(orderRecords, context),
      ...validateOrderBaseUrls(orderRecords, context),
    ],
    detectedTable,
  };
}

export function extractEans(rows: string[][], context: FileContext): ExtractedEans {
  const { records, issues, detectedTable } = extractRecords<EanField>(
    rows,
    EAN_COLUMNS,
    context,
  );
  const resolved = records.map(({ values, sourceRowNumber }) =>
    resolveIdentifierRecord(values, sourceRowNumber, context),
  );
  const eanRecords = resolved
    .map((result) => result.record)
    .filter((record): record is EanRecord => Boolean(record));
  const identifierIssues = resolved.flatMap((result) => result.issues);

  return {
    records: eanRecords,
    issues: [
      ...issues,
      ...identifierIssues,
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
  const identifiersByProduct = new Map<string, EanRecord[]>();
  const seenEans = new Set<string>();
  const seenUpcs = new Set<string>();
  const seenSkus = new Set<string>();

  for (const order of orders) {
    const orderKey = normalizeOrderProductKey(order);

    if (seenOrders.has(orderKey)) {
      issues.push({
        severity: "error",
        fileRole: "orders",
        rowNumber: order.sourceRowNumber,
        field: "purchase_order",
        message: "Make this purchase order/product pair unique.",
      });
      continue;
    }

    seenOrders.add(orderKey);
    uniqueOrders.push(order);
  }

  for (const eanRecord of eans) {
    const productKey = normalizeProductKey(eanRecord.product);
    const eanKey = normalizeIdentifierKey(eanRecord.ean);
    const upcKey = normalizeIdentifierKey(eanRecord.upc);
    const skuKey = normalizeIdentifierKey(eanRecord.sku);
    let hasDuplicateIdentifier = false;

    if (eanKey && seenEans.has(eanKey)) {
      hasDuplicateIdentifier = true;
      issues.push({
        severity: "error",
        fileRole: "eans",
        rowNumber: eanRecord.sourceRowNumber,
        field: "ean",
        message: "Make this EAN unique.",
      });
    }

    if (upcKey && seenUpcs.has(upcKey)) {
      hasDuplicateIdentifier = true;
      issues.push({
        severity: "error",
        fileRole: "eans",
        rowNumber: eanRecord.sourceRowNumber,
        field: "upc",
        message: "Make this UPC unique.",
      });
    }

    if (skuKey && seenSkus.has(skuKey)) {
      hasDuplicateIdentifier = true;
      issues.push({
        severity: "error",
        fileRole: "eans",
        rowNumber: eanRecord.sourceRowNumber,
        field: "sku",
        message: "Make this SKU unique.",
      });
    }

    if (hasDuplicateIdentifier) {
      continue;
    }

    if (eanKey) {
      seenEans.add(eanKey);
    }

    if (upcKey) {
      seenUpcs.add(upcKey);
    }

    if (skuKey) {
      seenSkus.add(skuKey);
    }

    const bucket = identifiersByProduct.get(productKey) ?? [];
    bucket.push(eanRecord);
    identifiersByProduct.set(productKey, bucket);
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
    const matches = identifiersByProduct.get(normalizeProductKey(order.product));

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
        identifier_row_number: match.sourceRowNumber,
        purchase_order: order.purchase_order,
        product: order.product,
        base_url: baseUrl,
        identifier_type: match.identifier_type,
        identifier: match.identifier,
        ean: match.ean,
        upc: match.upc,
        mode: match.mode,
        sku: match.sku,
        url: formatGeneratedUrl(baseUrl, match.identifier, order.purchase_order),
      });
    }
  }

  const sortedUrls = sortUrlRows(urls);

  if (urls.length === 0) {
    issues.push({
      severity: "warning",
      message:
        matchedOrderCount > 0
          ? "No URLs created: matching orders have invalid Base URLs."
          : "No URLs created: order products did not match EAN/UPC products.",
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
              message: `Add a ${formatFieldLabel(spec.label)} value.`,
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
          message: "Add at least one complete data row.",
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

function formatFieldLabel(label: string): string {
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

function normalizeIdentifierKey(value: string | undefined): string {
  return value ? normalizeDataText(value).toLowerCase() : "";
}

function normalizePurchaseOrderKey(value: string): string {
  return normalizeDataText(value).toUpperCase();
}

function normalizeOrderProductKey(record: OrderRecord): string {
  return `${normalizePurchaseOrderKey(record.purchase_order)}\u0000${normalizeProductKey(
    record.product,
  )}`;
}

function resolveIdentifierRecord(
  values: Record<EanField, string>,
  sourceRowNumber: number,
  context: FileContext,
): { record: EanRecord | null; issues: ProcessingIssue[] } {
  const ean = values.ean ?? "";
  const upc = values.upc ?? "";
  const normalizedMode = normalizeMode(values.mode ?? "");
  const issues: ProcessingIssue[] = [];

  if (!normalizedMode.ok) {
    return {
      record: null,
      issues: [
        withContext(
          {
            severity: "error",
            rowNumber: sourceRowNumber,
            field: "mode",
            message: 'Use "ean", "upc", or "upc only".',
          },
          context,
        ),
      ],
    };
  }

  const modeResult = resolveMode({
    ean,
    upc,
    explicitMode: normalizedMode.mode,
    sourceRowNumber,
    context,
  });

  issues.push(...modeResult.issues);

  if (!modeResult.ok) {
    return { record: null, issues };
  }

  const mode = modeResult.mode;
  const identifierType = mode === "ean" ? "ean" : "upc";
  const identifier = identifierType === "ean" ? ean : upc;

  issues.push(...validateIdentifier("ean", ean, sourceRowNumber, context));
  issues.push(...validateIdentifier("upc", upc, sourceRowNumber, context));

  return {
    record: {
      product: values.product,
      ean,
      upc,
      sku: values.sku ?? "",
      mode,
      identifier,
      identifier_type: identifierType,
      sourceRowNumber,
    },
    issues,
  };
}

function normalizeMode(
  value: string,
): { ok: true; mode: GtinMode | "" } | { ok: false } {
  const normalized = normalizeDataText(value);

  if (!normalized) {
    return { ok: true, mode: "" };
  }

  const mode = normalized.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const compactMode = mode.replace(/\s+/g, "");

  if (mode === "ean") {
    return { ok: true, mode: "ean" };
  }

  if (mode === "upc") {
    return { ok: true, mode: "upc" };
  }

  if (mode === "upc only" || compactMode === "upconly") {
    return { ok: true, mode: "upc_only" };
  }

  return { ok: false };
}

function resolveMode(input: {
  ean: string;
  upc: string;
  explicitMode: GtinMode | "";
  sourceRowNumber: number;
  context: FileContext;
}):
  | { ok: true; mode: GtinMode; issues: ProcessingIssue[] }
  | { ok: false; issues: ProcessingIssue[] } {
  const hasEan = !isMissingText(input.ean);
  const hasUpc = !isMissingText(input.upc);
  const issues: ProcessingIssue[] = [];

  if (!hasEan && !hasUpc) {
    return {
      ok: false,
      issues: [
        withContext(
          {
            severity: "error",
            rowNumber: input.sourceRowNumber,
            field: "ean",
            message: "Add an EAN or UPC value.",
          },
          input.context,
        ),
      ],
    };
  }

  if (!input.explicitMode) {
    if (hasEan) {
      return { ok: true, mode: "ean", issues };
    }

    return {
      ok: false,
      issues: [
        withContext(
          {
            severity: "error",
            rowNumber: input.sourceRowNumber,
            field: "mode",
            message: 'Set mode to "upc only" when only UPC is present.',
          },
          input.context,
        ),
      ],
    };
  }

  if (input.explicitMode === "ean") {
    if (hasEan) {
      return { ok: true, mode: "ean", issues };
    }

    return {
      ok: false,
      issues: [
        withContext(
          {
            severity: "error",
            rowNumber: input.sourceRowNumber,
            field: "ean",
            message: 'Add an EAN value for "ean" mode.',
          },
          input.context,
        ),
      ],
    };
  }

  if (input.explicitMode === "upc") {
    if (hasEan && hasUpc) {
      return { ok: true, mode: "upc", issues };
    }

    return {
      ok: false,
      issues: [
        withContext(
          {
            severity: "error",
            rowNumber: input.sourceRowNumber,
            field: "mode",
            message: "UPC mode needs both EAN and UPC values.",
          },
          input.context,
        ),
      ],
    };
  }

  if (!hasUpc) {
    return {
      ok: false,
      issues: [
        withContext(
          {
            severity: "error",
            rowNumber: input.sourceRowNumber,
            field: "upc",
            message: 'Add a UPC value for "upc only" mode.',
          },
          input.context,
        ),
      ],
    };
  }

  if (hasEan) {
    issues.push(
      withContext(
        {
          severity: "warning",
          rowNumber: input.sourceRowNumber,
          field: "mode",
          message: 'EAN will be ignored because mode is "upc only".',
        },
        input.context,
      ),
    );
  }

  return { ok: true, mode: "upc_only", issues };
}

function validateIdentifier(
  field: "ean" | "upc",
  value: string,
  sourceRowNumber: number,
  context: FileContext,
): ProcessingIssue[] {
  const issues: ProcessingIssue[] = [];
  const normalizedValue = normalizeDataText(value);

  if (isMissingText(normalizedValue)) {
    return issues;
  }

  if (!/^\d+$/.test(normalizedValue)) {
    issues.push(
      withContext(
        {
          severity: "warning",
          rowNumber: sourceRowNumber,
          field,
          message: `Review this ${field.toUpperCase()}. It contains non-digits.`,
        },
        context,
      ),
    );
    return issues;
  }

  const expectedLengths = field === "ean" ? [8, 12, 13, 14] : [8, 12];

  if (!expectedLengths.includes(normalizedValue.length)) {
    issues.push(
      withContext(
        {
          severity: "warning",
          rowNumber: sourceRowNumber,
          field,
          message:
            `Check this ${field.toUpperCase()} length. If leading zeroes are missing, format the column as text.`,
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
    const key = normalizeOrderProductKey(record);
    const firstRecord = seenOrders.get(key);

    if (firstRecord) {
      issues.push(
        withContext(
          {
            severity: "error",
            rowNumber: record.sourceRowNumber,
            field: "purchase_order",
            message: `Duplicate of row ${firstRecord.sourceRowNumber}. Make this purchase order/product pair unique.`,
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

function validateOrderBaseUrls(
  records: OrderRecord[],
  context: FileContext,
): ProcessingIssue[] {
  return records.flatMap((record) => {
    const result = parseBaseUrl(record);

    if (result.ok) {
      return result.issues.map((issue) => withContext(issue, context));
    }

    return [withContext(result.issue, context)];
  });
}

function validateDuplicateEans(
  records: EanRecord[],
  context: FileContext,
): ProcessingIssue[] {
  const seenEans = new Map<string, EanRecord>();
  const seenUpcs = new Map<string, EanRecord>();
  const seenSkus = new Map<string, EanRecord>();
  const issues: ProcessingIssue[] = [];

  for (const record of records) {
    const eanKey = normalizeIdentifierKey(record.ean);

    if (eanKey) {
      const firstEanRecord = seenEans.get(eanKey);

      if (firstEanRecord) {
        issues.push(
          withContext(
            {
              severity: "error",
              rowNumber: record.sourceRowNumber,
              field: "ean",
              message: `Duplicate of row ${firstEanRecord.sourceRowNumber}. Make this EAN unique.`,
            },
            context,
          ),
        );
      } else {
        seenEans.set(eanKey, record);
      }
    }

    const upcKey = normalizeIdentifierKey(record.upc);

    if (upcKey) {
      const firstUpcRecord = seenUpcs.get(upcKey);

      if (firstUpcRecord) {
        issues.push(
          withContext(
            {
              severity: "error",
              rowNumber: record.sourceRowNumber,
              field: "upc",
              message: `Duplicate of row ${firstUpcRecord.sourceRowNumber}. Make this UPC unique.`,
            },
            context,
          ),
        );
      } else {
        seenUpcs.set(upcKey, record);
      }
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
            message: `Duplicate of row ${firstSkuRecord.sourceRowNumber}. Make this SKU unique.`,
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

function sortUrlRows(rows: UrlOutputRow[]): UrlOutputRow[] {
  return [...rows].sort((a, b) =>
    [
      compareText(a.purchase_order, b.purchase_order),
      compareText(normalizeProductKey(a.product), normalizeProductKey(b.product)),
      compareText(a.product, b.product),
      compareText(a.sku, b.sku),
      compareText(a.identifier_type, b.identifier_type),
      a.identifier.localeCompare(b.identifier, undefined, { numeric: true }),
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

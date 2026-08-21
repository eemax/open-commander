import ExcelJS from "exceljs";

import { deriveOutputFileName } from "./fileRoles";
import { normalizeDataText } from "./headers";
import {
  buildUrls,
  extractEans,
  extractOrders,
} from "./transform";
import {
  XLSX_MIME_TYPE,
  URL_GENERATOR_SCRIPT_ID,
  type DetectedTable,
  type GtinMode,
  type ProcessingIssue,
  type RunStageHandler,
  type UnmatchedOrderRow,
  type UploadedScriptFile,
  type UrlGeneratorRunResult,
  type UrlOutputRow,
} from "./types";

type WorkbookRows = {
  sheetName: string;
  rows: string[][];
};

export class FatalInputIssueError extends Error {
  readonly issues: ProcessingIssue[];

  constructor(issues: ProcessingIssue[]) {
    const errors = issues.filter((issue) => issue.severity === "error");

    super(formatFatalInputIssueMessage(errors));
    this.name = "FatalInputIssueError";
    this.issues = errors;
  }
}

export async function runUrlGenerator(
  files: UploadedScriptFile[],
  options: { onStage?: RunStageHandler } = {},
): Promise<UrlGeneratorRunResult> {
  const ordersFile = files.find((file) => file.role === "orders");
  const eansFile = files.find((file) => file.role === "eans");

  if (!ordersFile || !eansFile) {
    throw new Error("Both an orders workbook and an EAN/UPC workbook are required.");
  }

  options.onStage?.("reading-orders-workbook");
  const ordersWorkbook = await readWorkbookRows(ordersFile.buffer);

  options.onStage?.("reading-eans-workbook");
  const eansWorkbook = await readWorkbookRows(eansFile.buffer);

  options.onStage?.("building-urls");
  const orders = extractOrders(ordersWorkbook.rows, {
    fileRole: "orders",
    fileName: ordersFile.fileName,
    sheetName: ordersWorkbook.sheetName,
  });
  const eans = extractEans(eansWorkbook.rows, {
    fileRole: "eans",
    fileName: eansFile.fileName,
    sheetName: eansWorkbook.sheetName,
  });
  const inputIssues = [...orders.issues, ...eans.issues];
  assertNoFatalInputIssues(inputIssues);

  const built = buildUrls(orders.records, eans.records);
  const issues = [...inputIssues, ...built.issues];
  assertNoFatalInputIssues(issues);

  options.onStage?.("writing-output-workbook");
  const outputBuffer = await writeOutputWorkbook({
    urls: built.urls,
    unmatchedOrders: built.unmatchedOrders,
    issues,
    detectedTables: [orders.detectedTable, eans.detectedTable],
    ordersRead: orders.records.length,
    eansRead: eans.records.length,
  });

  return {
    scriptId: URL_GENERATOR_SCRIPT_ID,
    outputFileName: deriveOutputFileName(ordersFile.fileName, eansFile.fileName),
    outputBuffer,
    mimeType: XLSX_MIME_TYPE,
    stats: {
      ordersRead: orders.records.length,
      eansRead: eans.records.length,
      urlsCreated: built.urls.length,
      unmatchedOrders: built.unmatchedOrders.length,
      issues: issues.length,
    },
    previewRows: built.urls.slice(0, 5),
    issues,
    detectedTables: [orders.detectedTable, eans.detectedTable],
  };
}

function assertNoFatalInputIssues(issues: ProcessingIssue[]): void {
  const errors = issues.filter((issue) => issue.severity === "error");

  if (errors.length === 0) {
    return;
  }

  throw new FatalInputIssueError(errors);
}

function formatFatalInputIssueMessage(errors: ProcessingIssue[]): string {
  const shownErrors = errors.slice(0, 5).map(formatIssueSummary);
  const remainingErrorCount = errors.length - shownErrors.length;
  const suffix =
    remainingErrorCount > 0
      ? `; and ${remainingErrorCount} more error${
          remainingErrorCount === 1 ? "" : "s"
        }`
      : "";
  const errorLabel = errors.length === 1 ? "error" : "errors";

  return `Run failed because input data has ${errors.length} ${errorLabel}: ${shownErrors.join(
    "; ",
  )}${suffix}.`;
}

function formatIssueSummary(issue: ProcessingIssue): string {
  const location = [
    issue.fileName ?? issue.fileRole,
    issue.rowNumber ? `row ${issue.rowNumber}` : "",
    issue.field ?? "",
  ].filter(Boolean);

  return `${location.length > 0 ? `${location.join(" ")}: ` : ""}${
    issue.message
  }`;
}

async function readWorkbookRows(buffer: ArrayBuffer): Promise<WorkbookRows> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets.find((sheet) => sheet.actualRowCount > 0);

  if (!worksheet) {
    throw new Error("The workbook does not contain a readable worksheet.");
  }

  const maxColumns = Math.max(worksheet.actualColumnCount, 1);
  const rows: string[][] = [];

  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values: string[] = [];

    for (let columnIndex = 1; columnIndex <= maxColumns; columnIndex += 1) {
      values.push(cellToText(row.getCell(columnIndex)));
    }

    rows[rowNumber - 1] = values;
  });

  return {
    sheetName: worksheet.name,
    rows: trimEmptyBounds(rows),
  };
}

function cellToText(cell: ExcelJS.Cell): string {
  return cellValueToText(cell.value, cell.numFmt);
}

function cellValueToText(value: ExcelJS.CellValue, numberFormat?: string): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    return numberToText(value, numberFormat);
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => cellValueToText(item as ExcelJS.CellValue, numberFormat))
      .join("");
  }

  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join("");
  }

  if ("text" in value && value.text) {
    return String(value.text);
  }

  if ("result" in value && value.result !== undefined) {
    return cellValueToText(value.result as ExcelJS.CellValue, numberFormat);
  }

  if ("formula" in value && value.formula) {
    return String(value.formula);
  }

  if ("error" in value && value.error) {
    return String(value.error);
  }

  return "";
}

function numberToText(value: number, numberFormat?: string): string {
  const integerText = Number.isInteger(value) ? String(value) : null;

  if (integerText && numberFormat) {
    const zeroFormat = simpleZeroPaddingFormat(numberFormat);

    if (zeroFormat) {
      const sign = value < 0 ? "-" : "";
      const unsignedText = Math.abs(value).toString();
      return `${sign}${unsignedText.padStart(zeroFormat.length, "0")}`;
    }
  }

  return String(value);
}

function simpleZeroPaddingFormat(numberFormat: string): string | null {
  const positiveFormat = numberFormat.split(";")[0]?.trim() ?? "";
  return /^0+$/.test(positiveFormat) ? positiveFormat : null;
}

export function trimEmptyBounds(rows: string[][]): string[][] {
  const normalizedRows = rows.map((row) => row.map(normalizeDataText));
  let lastRowIndex = normalizedRows.length - 1;

  while (
    lastRowIndex >= 0 &&
    normalizedRows[lastRowIndex].every((value) => value === "")
  ) {
    lastRowIndex -= 1;
  }

  const rowsWithContent = normalizedRows.slice(0, lastRowIndex + 1);
  let lastColumnIndex =
    rowsWithContent.reduce((max, row) => Math.max(max, row.length), 0) - 1;

  while (
    lastColumnIndex >= 0 &&
    rowsWithContent.every((row) => (row[lastColumnIndex] ?? "") === "")
  ) {
    lastColumnIndex -= 1;
  }

  return rowsWithContent.map((row) => row.slice(0, lastColumnIndex + 1));
}

async function writeOutputWorkbook(input: {
  urls: UrlOutputRow[];
  unmatchedOrders: UnmatchedOrderRow[];
  issues: ProcessingIssue[];
  detectedTables: DetectedTable[];
  ordersRead: number;
  eansRead: number;
}): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Open Commander";
  workbook.created = new Date();
  workbook.modified = new Date();

  const urlRows = input.urls.map(formatUrlOutputRow);

  addRowsSheet(workbook, "urls", [
    "purchase_order",
    "product",
    "sku",
    "identifier_type",
    "identifier",
    "ean",
    "upc",
    "mode",
    "base_url",
    "url",
    "order_row_number",
    "identifier_row_number",
  ], urlRows);

  if (input.unmatchedOrders.length > 0) {
    addRowsSheet(workbook, "unmatched_orders", [
      "purchase_order",
      "product",
      "base_url",
      "order_row_number",
    ], input.unmatchedOrders);
  }

  if (input.issues.length > 0) {
    addRowsSheet(workbook, "input_issues", [
      "severity",
      "file",
      "sheet",
      "row",
      "field",
      "message",
    ], input.issues.map((issue) => ({
      severity: issue.severity,
      file: issue.fileName ?? issue.fileRole ?? "",
      sheet: issue.sheetName ?? "",
      row: issue.rowNumber ?? "",
      field: issue.field ?? "",
      message: issue.message,
    })));
  }

  addRowsSheet(workbook, "summary", ["section", "item", "value", "detail"], [
    ...buildSummaryRows(input),
  ]);

  const written = await workbook.xlsx.writeBuffer();
  return toArrayBuffer(written);
}

function formatUrlOutputRow(row: UrlOutputRow): Record<string, string | number> {
  return {
    ...row,
    mode: formatModeForOutput(row.mode),
  };
}

function formatModeForOutput(mode: GtinMode): string {
  return mode === "upc_only" ? "upc only" : mode;
}

export function addRowsSheet<T extends Record<string, unknown>>(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  headers: string[],
  rows: T[],
): void {
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.addRow(headers);

  for (const row of rows) {
    worksheet.addRow(headers.map((header) => row[header] ?? ""));
  }

  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: headers.length },
  };

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F3D36" },
  };
  headerRow.alignment = { vertical: "middle" };

  headers.forEach((header, index) => {
    const column = worksheet.getColumn(index + 1);
    let longest = header.length;

    for (const row of rows) {
      const length = String(row[header] ?? "").length;

      if (length > longest) {
        longest = length;
      }
    }

    const maxWidth = ["url", "value", "detail"].includes(header) ? 90 : 32;
    column.width = Math.min(Math.max(longest + 2, 12), maxWidth);
    column.alignment = { vertical: "top", wrapText: true };
  });
}

type SummaryInput = {
  urls: UrlOutputRow[];
  unmatchedOrders: UnmatchedOrderRow[];
  issues: ProcessingIssue[];
  detectedTables: DetectedTable[];
  ordersRead: number;
  eansRead: number;
};

type SummaryRow = {
  section: string;
  item: string;
  value: string | number;
  detail?: string;
};

function buildSummaryRows(input: SummaryInput): SummaryRow[] {
  const ordersTable = input.detectedTables.find(
    (table) => table.fileRole === "orders",
  );
  const eansTable = input.detectedTables.find((table) => table.fileRole === "eans");
  const rows: SummaryRow[] = [
    {
      section: "Run overview",
      item: "URL format",
      value: "{base_url}/01/{identifier}/10/{purchase_order}",
      detail: "Identifier and purchase order values are URL path encoded.",
    },
    {
      section: "Results",
      item: "URLs created",
      value: input.urls.length,
      detail: "Rows written to the urls sheet.",
    },
    {
      section: "Results",
      item: "Orders read",
      value: input.ordersRead,
      detail: "Usable order rows after header detection, required-cell checks, and duplicate purchase order/product validation.",
    },
    {
      section: "Results",
      item: "EAN/UPC rows read",
      value: input.eansRead,
      detail: "Usable EAN/UPC rows after header detection, mode checks, required-cell checks, and duplicate EAN/UPC/SKU validation.",
    },
    {
      section: "Results",
      item: "Unmatched orders",
      value: input.unmatchedOrders.length,
      detail: "Unique order/product/base URL combinations with no matching EAN/UPC product.",
    },
    {
      section: "Source tables",
      item: "Orders workbook",
      value: ordersTable?.fileName ?? "",
      detail: formatDetectedTable(ordersTable),
    },
    {
      section: "Source tables",
      item: "EAN/UPC workbook",
      value: eansTable?.fileName ?? "",
      detail: formatDetectedTable(eansTable),
    },
  ];

  rows.push(...formatDetectedHeaderRows("Orders", ordersTable));
  rows.push(...formatDetectedHeaderRows("EAN/UPC", eansTable));

  if (input.issues.length > 0) {
    rows.push({
      section: "Input issues",
      item: "Warnings and non-fatal issues",
      value: input.issues.length,
      detail: "See the input_issues sheet for row-level details.",
    });
  }

  return rows;
}

function formatDetectedTable(table?: DetectedTable): string {
  if (!table) {
    return "";
  }

  const header =
    table.headerRowNumber === null
      ? "no matching header row"
      : `header row ${table.headerRowNumber}`;
  const dataStart = `data starts row ${table.dataStartRowNumber}`;
  const columns = table.columns
    .map((column) => `${column.headerText} -> ${column.key}`)
    .join("; ");

  return `${table.sheetName}; ${header}; ${dataStart}; ${columns || "no columns matched"}`;
}

function formatDetectedHeaderRows(
  role: "Orders" | "EAN/UPC",
  table?: DetectedTable,
): SummaryRow[] {
  if (!table) {
    return [];
  }

  return table.columns.map((column) => ({
    section: "Detected headers",
    item: `${role} column ${column.columnName}`,
    value: column.headerText,
    detail: `Resolved to ${column.key} (${column.label}).`,
  }));
}

function toArrayBuffer(value: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value;
  }

  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

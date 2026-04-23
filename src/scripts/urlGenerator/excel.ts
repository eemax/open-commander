import ExcelJS from "exceljs";

import { deriveOutputFileName } from "./fileRoles";
import { normalizeDataText } from "./headers";
import { buildUrls, extractEans, extractOrders } from "./transform";
import {
  XLSX_MIME_TYPE,
  URL_GENERATOR_SCRIPT_ID,
  type DetectedTable,
  type ProcessingIssue,
  type UnmatchedOrderRow,
  type UploadedScriptFile,
  type UrlGeneratorRunResult,
  type UrlOutputRow,
} from "./types";

type WorkbookRows = {
  sheetName: string;
  rows: string[][];
};

export async function runUrlGenerator(
  files: UploadedScriptFile[],
): Promise<UrlGeneratorRunResult> {
  const ordersFile = files.find((file) => file.role === "orders");
  const eansFile = files.find((file) => file.role === "eans");

  if (!ordersFile || !eansFile) {
    throw new Error("Both an orders workbook and an EAN workbook are required.");
  }

  const [ordersWorkbook, eansWorkbook] = await Promise.all([
    readWorkbookRows(ordersFile.buffer),
    readWorkbookRows(eansFile.buffer),
  ]);

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

  const outputBuffer = await writeOutputWorkbook({
    urls: built.urls,
    unmatchedOrders: built.unmatchedOrders,
    issues,
    detectedTables: [orders.detectedTable, eans.detectedTable],
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
    issues,
    detectedTables: [orders.detectedTable, eans.detectedTable],
  };
}

function assertNoFatalInputIssues(issues: ProcessingIssue[]): void {
  const errors = issues.filter((issue) => issue.severity === "error");

  if (errors.length === 0) {
    return;
  }

  const shownErrors = errors.slice(0, 5).map(formatIssueSummary);
  const remainingErrorCount = errors.length - shownErrors.length;
  const suffix =
    remainingErrorCount > 0
      ? `; and ${remainingErrorCount} more error${
          remainingErrorCount === 1 ? "" : "s"
        }`
      : "";

  throw new Error(
    `Run failed because input data has errors: ${shownErrors.join(
      "; ",
    )}${suffix}.`,
  );
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

function trimEmptyBounds(rows: string[][]): string[][] {
  const normalizedRows = rows.map((row) => row.map(normalizeDataText));
  let lastRowIndex = normalizedRows.length - 1;

  while (
    lastRowIndex >= 0 &&
    normalizedRows[lastRowIndex].every((value) => value === "")
  ) {
    lastRowIndex -= 1;
  }

  const rowsWithContent = normalizedRows.slice(0, lastRowIndex + 1);
  let lastColumnIndex = Math.max(0, ...rowsWithContent.map((row) => row.length)) - 1;

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
}): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Open Commander";
  workbook.created = new Date();
  workbook.modified = new Date();

  addRowsSheet(workbook, "urls", [
    "purchase_order",
    "product",
    "sku",
    "ean",
    "base_url",
    "url",
    "order_row_number",
    "ean_row_number",
  ], input.urls);

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

  addRowsSheet(workbook, "summary", ["item", "value"], [
    { item: "URLs created", value: input.urls.length },
    { item: "Unmatched orders", value: input.unmatchedOrders.length },
    { item: "Issues", value: input.issues.length },
    {
      item: "Orders columns",
      value: formatDetectedColumns(
        input.detectedTables.find((table) => table.fileRole === "orders"),
      ),
    },
    {
      item: "EAN columns",
      value: formatDetectedColumns(
        input.detectedTables.find((table) => table.fileRole === "eans"),
      ),
    },
  ]);

  const written = await workbook.xlsx.writeBuffer();
  return toArrayBuffer(written);
}

function addRowsSheet<T extends Record<string, unknown>>(
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
    const longest = Math.max(
      header.length,
      ...rows.map((row) => String(row[header] ?? "").length),
    );
    column.width = Math.min(Math.max(longest + 2, 12), header === "url" ? 80 : 32);
  });
}

function formatDetectedColumns(table?: DetectedTable): string {
  if (!table) {
    return "";
  }

  const header =
    table.headerRowNumber === null
      ? "no header row"
      : `header row ${table.headerRowNumber}`;
  const columns = table.columns
    .map((column) => `${column.label}: ${column.columnName} (${column.match})`)
    .join("; ");

  return `${table.fileName}, ${table.sheetName}, ${header}; ${columns}`;
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

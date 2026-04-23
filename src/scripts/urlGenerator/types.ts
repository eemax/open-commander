export const URL_GENERATOR_SCRIPT_ID = "url-generator-dpp";
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type FileRole = "orders" | "eans";

export type IssueSeverity = "info" | "warning" | "error";

export type ProcessingIssue = {
  severity: IssueSeverity;
  message: string;
  fileRole?: FileRole;
  fileName?: string;
  sheetName?: string;
  rowNumber?: number;
  field?: string;
};

export type UploadedScriptFile = {
  role: FileRole;
  fileName: string;
  buffer: ArrayBuffer;
};

export type DetectedColumn = {
  key: string;
  label: string;
  columnIndex: number;
  columnName: string;
  match: "header" | "fallback";
};

export type DetectedTable = {
  fileRole: FileRole;
  fileName: string;
  sheetName: string;
  headerRowNumber: number | null;
  dataStartRowNumber: number;
  columns: DetectedColumn[];
};

export type OrderRecord = {
  purchase_order: string;
  product: string;
  base_url: string;
  sourceRowNumber: number;
};

export type EanRecord = {
  product: string;
  ean: string;
  sku: string;
  sourceRowNumber: number;
};

export type UrlOutputRow = {
  purchase_order: string;
  product: string;
  sku: string;
  ean: string;
  base_url: string;
  url: string;
  order_row_number: number;
  ean_row_number: number;
};

export type UnmatchedOrderRow = {
  purchase_order: string;
  product: string;
  base_url: string;
  order_row_number: number;
};

export type UrlGeneratorStats = {
  ordersRead: number;
  eansRead: number;
  urlsCreated: number;
  unmatchedOrders: number;
  issues: number;
};

export type UrlGeneratorRunResult = {
  scriptId: typeof URL_GENERATOR_SCRIPT_ID;
  outputFileName: string;
  outputBuffer: ArrayBuffer;
  mimeType: typeof XLSX_MIME_TYPE;
  stats: UrlGeneratorStats;
  issues: ProcessingIssue[];
  detectedTables: DetectedTable[];
};

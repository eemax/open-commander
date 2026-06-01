import { AlertTriangle, Download } from "lucide-react";

import { downloadArrayBuffer } from "../lib/download";
import type {
  ProcessingIssue,
  UrlGeneratorRunResult,
} from "../scripts/urlGenerator/types";
import { MAX_SUCCESS_ISSUES_SHOWN } from "./constants";
import { roleLabel } from "./fileSelection";

export function ResultView({ result }: { result: UrlGeneratorRunResult }) {
  const shownIssues = result.issues.slice(0, MAX_SUCCESS_ISSUES_SHOWN);
  const issueSummary = summarizeIssues(result.issues);
  const successSummary = formatSuccessSummary(result);

  return (
    <div className="result-content">
      <div className="result-header">
        <div>
          <h3>{result.outputFileName}</h3>
          <p>{successSummary}</p>
          {issueSummary ? <small>{issueSummary}</small> : null}
        </div>
        <button
          className="download-button"
          type="button"
          onClick={() =>
            downloadArrayBuffer(
              result.outputBuffer,
              result.outputFileName,
              result.mimeType,
            )
          }
        >
          <Download aria-hidden="true" size={18} />
          <span>Download</span>
        </button>
      </div>

      <div className="stat-grid">
        <Stat label="URLs" value={result.stats.urlsCreated} />
        <Stat label="Orders" value={result.stats.ordersRead} />
        <Stat label="EAN/UPC" value={result.stats.eansRead} />
        <Stat label="Unmatched" value={result.stats.unmatchedOrders} />
      </div>

      <ResultPreview rows={result.previewRows} />

      <div className="detected-grid">
        {result.detectedTables.map((table) => (
          <div className="detected-row" key={table.fileRole}>
            <strong>{roleLabel(table.fileRole)}</strong>
            <span>
              {table.headerRowNumber
                ? `Header row ${table.headerRowNumber}`
                : "No matching header row"}
            </span>
            <small>
              {table.columns
                .map((column) => `${column.label} ${column.columnName}`)
                .join(" · ")}
            </small>
          </div>
        ))}
      </div>

      {shownIssues.length > 0 && (
        <div className="issues">
          <div className="issues-heading">
            <AlertTriangle aria-hidden="true" size={18} />
            <h3>
              Warnings to review <span>{result.issues.length.toLocaleString()}</span>
            </h3>
          </div>
          <IssueTable issues={shownIssues} />
          {result.issues.length > shownIssues.length && (
            <p className="issue-footnote">
              {result.issues.length - shownIssues.length} more warning
              {result.issues.length - shownIssues.length === 1 ? "" : "s"} in the
              output workbook.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function IssueTable({ issues }: { issues: ProcessingIssue[] }) {
  return (
    <div className="issue-table">
      <div className="issue-row issue-row-head">
        <span>File</span>
        <span>Where</span>
        <span>Fix</span>
      </div>
      {issues.map((issue, index) => (
        <div
          className={`issue-row issue-${issue.severity}`}
          key={`${issue.message}-${index}`}
        >
          <span>{formatIssueSource(issue)}</span>
          <span>{formatIssueLocation(issue)}</span>
          <p>{issue.message}</p>
        </div>
      ))}
    </div>
  );
}

export function resultStatusLabel(result: UrlGeneratorRunResult): string {
  const counts = countIssues(result.issues);

  if (counts.error > 0) {
    return "Completed with errors";
  }

  if (counts.warning > 0) {
    return "Ready with warnings";
  }

  return "Ready";
}

export function resultStatusClassName(result: UrlGeneratorRunResult): string {
  const counts = countIssues(result.issues);

  if (counts.error > 0) {
    return "status-pill status-error";
  }

  if (counts.warning > 0) {
    return "status-pill status-warning";
  }

  return "status-pill status-ready";
}

function ResultPreview({ rows }: { rows: UrlGeneratorRunResult["previewRows"] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="result-preview">
      <div className="preview-heading">
        <h3>Preview</h3>
        <span>First {rows.length} generated rows</span>
      </div>
      <div className="preview-table" aria-label="Generated URL preview">
        <div className="preview-row preview-head">
          <span>Purchase order</span>
          <span>Product</span>
          <span>SKU</span>
          <span>Type</span>
          <span>Identifier</span>
          <span>URL</span>
        </div>
        {rows.map((row) => (
          <div
            className="preview-row"
            key={`${row.purchase_order}-${row.product}-${row.identifier}`}
          >
            <span>{row.purchase_order}</span>
            <span>{row.product}</span>
            <span>{row.sku || "-"}</span>
            <span>{formatIdentifierType(row.identifier_type)}</span>
            <span>{row.identifier}</span>
            <span>{row.url}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function summarizeIssues(issues: UrlGeneratorRunResult["issues"]): string {
  const counts = countIssues(issues);
  const parts = [
    counts.error > 0 ? formatCount(counts.error, "error") : "",
    counts.warning > 0 ? formatCount(counts.warning, "warning") : "",
    counts.info > 0 ? formatCount(counts.info, "note") : "",
  ].filter(Boolean);

  return parts.length > 0 ? `${parts.join(", ")} to review.` : "";
}

function countIssues(issues: UrlGeneratorRunResult["issues"]) {
  return issues.reduce(
    (counts, issue) => ({
      ...counts,
      [issue.severity]: counts[issue.severity] + 1,
    }),
    { error: 0, warning: 0, info: 0 },
  );
}

function formatSuccessSummary(result: UrlGeneratorRunResult): string {
  const urls = result.stats.urlsCreated.toLocaleString();
  const unmatched = result.stats.unmatchedOrders;
  const unmatchedText =
    unmatched > 0
      ? `${formatCount(unmatched, "order")} did not match an EAN/UPC product.`
      : "All orders matched.";

  return `Output created with ${urls} URL${
    result.stats.urlsCreated === 1 ? "" : "s"
  }. ${unmatchedText}`;
}

function formatCount(count: number, singular: string): string {
  return `${count.toLocaleString()} ${singular}${count === 1 ? "" : "s"}`;
}

function formatIdentifierType(
  type: UrlGeneratorRunResult["previewRows"][number]["identifier_type"],
): string {
  return type.toUpperCase();
}

function formatIssueSource(issue: ProcessingIssue): string {
  const source =
    issue.fileName ?? (issue.fileRole ? roleLabel(issue.fileRole) : "output");

  return issue.sheetName ? `${source} · ${issue.sheetName}` : source;
}

function formatIssueLocation(issue: ProcessingIssue): string {
  const parts = [
    issue.rowNumber ? `Row ${issue.rowNumber}` : "",
    issue.field ?? "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "Workbook";
}

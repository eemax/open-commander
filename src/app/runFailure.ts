import type { ProcessingIssue } from "../scripts/urlGenerator/types";
import { WorkerRunError, WorkerUnexpectedError } from "./runInWorker";
import { formatRunStage } from "./runStatus";
import type { RunFailure } from "./types";

export function describeRunFailure(
  error: unknown,
  options: { compatibilityTried?: boolean } = {},
): RunFailure {
  if (error instanceof WorkerRunError && error.kind === "input-issues") {
    const issues = error.issues.filter((issue) => issue.severity === "error");

    if (issues.length > 0) {
      const errorCount = issues.length;

      return {
        title: "Fix input errors",
        summary: `No output was created. Fix ${formatCount(
          errorCount,
          "input error",
        )}, then run again.`,
        nextSteps: buildInputFailureSteps(issues),
        issues,
      };
    }
  }

  if (options.compatibilityTried) {
    return {
      title: "Processing still failed",
      summary:
        "The browser could not finish the run. Your files may still be valid.",
      nextSteps: [
        "Try the same files in Google Chrome.",
        "If Chrome also fails, send the workbook pair for review.",
      ],
      issues: [],
      details: formatRuntimeDetails(error),
    };
  }

  if (error instanceof WorkerUnexpectedError) {
    return {
      title: "Browser processing stopped",
      summary:
        "The browser could not finish processing. Your files may still be valid.",
      nextSteps: [
        "Try compatibility mode.",
        "If compatibility mode also fails, try the same files in Google Chrome.",
      ],
      issues: [],
      details: formatUnexpectedWorkerDetails(error),
      canUseCompatibilityMode: true,
    };
  }

  if (error instanceof WorkerRunError && error.kind === "runtime") {
    return {
      title: "Processing stopped",
      summary:
        "The browser could not finish processing. Your files may still be valid.",
      nextSteps: [
        "Try compatibility mode.",
        "If compatibility mode also fails, try the same files in Google Chrome.",
      ],
      issues: [],
      details: formatWorkerRuntimeDetails(error),
      canUseCompatibilityMode: true,
    };
  }

  const message =
    error instanceof Error ? error.message : "The files could not be processed.";

  return {
    title: "Run could not complete",
    summary: "No output was created.",
    nextSteps: [
      "Check that both files are valid .xlsx workbooks.",
      "Make sure neither workbook is password-protected.",
      "Upload the corrected files and run again.",
    ],
    issues: [],
    details: message,
  };
}

function formatUnexpectedWorkerDetails(error: WorkerUnexpectedError): string {
  const lastStage = error.lastStage
    ? formatRunStage(error.lastStage, "details")
    : "The processor stopped before reporting a stage.";

  return `Last stage: ${lastStage}. Error: ${error.message}. Browser: ${navigator.userAgent}`;
}

function formatWorkerRuntimeDetails(error: WorkerRunError): string {
  const lastStage = error.lastStage
    ? formatRunStage(error.lastStage, "details")
    : "The processor did not report a stage.";

  return `Last stage: ${lastStage}. Error: ${error.message}. Browser: ${navigator.userAgent}`;
}

function formatRuntimeDetails(error: unknown): string {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return `${message}. Browser: ${navigator.userAgent}`;
}

function buildInputFailureSteps(issues: ProcessingIssue[]): string[] {
  const messages = issues.map((issue) => issue.message.toLowerCase());
  const fields = new Set(issues.map((issue) => issue.field).filter(Boolean));
  const hasBaseUrlIssue =
    fields.has("base_url") || messages.some((message) => message.includes("base url"));
  const hasDuplicateIssue = messages.some((message) =>
    message.includes("duplicate"),
  );
  const hasMissingRequiredIssue = messages.some(
    (message) =>
      message.includes("add a") ||
      message.includes("add an") ||
      message.includes("required column") ||
      message.includes("complete data row"),
  );
  const hasIdentifierModeIssue =
    fields.has("mode") ||
    messages.some(
      (message) =>
        message.includes("mode") ||
        message.includes("upc-only") ||
        message.includes("upc only"),
    );
  const hasIdentifierFormatIssue = messages.some(
    (message) =>
      message.includes("digits only") ||
      message.includes("ean length") ||
      message.includes("upc length"),
  );
  const steps: string[] = [];

  if (hasMissingRequiredIssue) {
    steps.push("Add the missing required columns or values.");
  }

  if (hasBaseUrlIssue) {
    steps.push(
      "Fix Base URLs: use an https root domain, usually https://id.yourdomain.com.",
    );
  }

  if (hasDuplicateIssue) {
    steps.push("Remove duplicate order/product, EAN, UPC, or SKU values.");
  }

  if (hasIdentifierModeIssue) {
    steps.push('Fix mode values: use "ean", "upc", or "upc only".');
  }

  if (hasIdentifierFormatIssue) {
    steps.push(
      "Check EAN/UPC values. Use text formatting when leading zeroes matter.",
    );
  }

  if (steps.length === 0) {
    steps.push("Fix the rows listed below.");
  }

  steps.push("Save the workbook, upload it again, and rerun.");

  return steps;
}

function formatCount(count: number, singular: string): string {
  return `${count.toLocaleString()} ${singular}${count === 1 ? "" : "s"}`;
}

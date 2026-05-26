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
        title: "Input data needs changes",
        summary: `The workbook data needs to be fixed before Open Commander can create an output. ${errorCount.toLocaleString()} input ${
          errorCount === 1 ? "error was" : "errors were"
        } found.`,
        nextSteps: buildInputFailureSteps(issues),
        issues,
      };
    }
  }

  if (options.compatibilityTried) {
    return {
      title: "Compatibility mode could not complete",
      summary:
        "The browser still could not finish this workbook run. The files may still be valid.",
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
      title: "The browser stopped the workbook processor",
      summary:
        "Open Commander retried the background workbook processor once, but the browser stopped it before completion.",
      nextSteps: [
        "Try compatibility mode. It may make this tab feel busy briefly while it runs.",
        "If compatibility mode also fails, try the same files in Google Chrome.",
      ],
      issues: [],
      details: formatUnexpectedWorkerDetails(error),
      canUseCompatibilityMode: true,
    };
  }

  if (error instanceof WorkerRunError && error.kind === "runtime") {
    return {
      title: "Workbook processor could not complete",
      summary:
        "Open Commander retried the background workbook processor once, but the browser still could not finish the run.",
      nextSteps: [
        "Try compatibility mode. It may make this tab feel busy briefly while it runs.",
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
    summary: "The browser could not create an output workbook from these files.",
    nextSteps: [
      "Check that both selected files are valid .xlsx workbooks and are not password-protected.",
      "Upload the corrected files and run the script again.",
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
      message.includes("mandatory field") ||
      message.includes("required column") ||
      message.includes("no usable data rows"),
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
      message.includes("ean contains") ||
      message.includes("upc contains") ||
      message.includes("ean length") ||
      message.includes("upc length"),
  );
  const steps = [
    "Edit the listed rows in the source workbook, save the file, then upload the corrected workbook.",
    "The rows below are the errors Open Commander can validate in this pass. After these are fixed, a later run may find more.",
  ];

  if (hasMissingRequiredIssue) {
    steps.push(
      "Orders need purchase_order, product, and base_url. EAN/UPC rows need product plus the required identifier columns for their mode.",
    );
  }

  if (hasBaseUrlIssue) {
    steps.push(
      "Base URL values must be https root domains like https://id.example.com; replace template placeholders before generating and remove paths such as /product, query strings, and http:// values.",
    );
  }

  if (hasDuplicateIssue) {
    steps.push(
      "Make duplicate purchase order/product combinations, EANs, UPCs, and SKUs unique.",
    );
  }

  if (hasIdentifierModeIssue) {
    steps.push(
      'For UPC-only URLs, set mode to "upc only". For UPC mode, include both EAN and UPC values.',
    );
  }

  if (hasIdentifierFormatIssue) {
    steps.push(
      "EAN and UPC values must contain digits only. Format source columns as text when leading zeroes matter.",
    );
  }

  steps.push("Run the script again after the source data is corrected.");

  return steps;
}

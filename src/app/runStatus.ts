import type { RunStageId } from "../scripts/urlGenerator/types";

export function formatWorkerAttemptStatus(attempt: number, status: string): string {
  return attempt === 1 ? status : `Retry ${attempt - 1}: ${status}`;
}

export function formatRunStage(
  stage: RunStageId,
  mode: "worker" | "compatibility" | "details",
  attempt = 1,
): string {
  const label = runStageLabel(stage);

  if (mode === "details") {
    return label;
  }

  if (mode === "compatibility") {
    return `Compatibility mode: ${label}`;
  }

  return formatWorkerAttemptStatus(attempt, label);
}

function runStageLabel(stage: RunStageId): string {
  switch (stage) {
    case "worker-started":
      return "Workbook processor started";
    case "loading-excel-engine":
      return "Loading Excel engine";
    case "reading-orders-workbook":
      return "Reading orders workbook";
    case "reading-eans-workbook":
      return "Reading EAN/UPC workbook";
    case "building-urls":
      return "Building URLs";
    case "writing-output-workbook":
      return "Writing output workbook";
    case "complete":
      return "Workbook complete";
  }
}

import { CheckCircle2, Loader2 } from "lucide-react";

const runProgressSteps = [
  "Read files",
  "Start processor",
  "Load Excel",
  "Read orders",
  "Read EAN/UPC",
  "Build URLs",
  "Write workbook",
];

export function RunProgress({ status }: { status: string }) {
  const activeIndex = runProgressIndex(status);

  return (
    <div className="run-progress" aria-label="Run progress">
      {runProgressSteps.map((step, index) => {
        const isActive = index === activeIndex;
        const isComplete = index < activeIndex;
        const state = isActive ? "active" : isComplete ? "complete" : "pending";

        return (
          <div className={`run-progress-step run-progress-${state}`} key={step}>
            <span className="run-progress-dot" aria-hidden="true" />
            <span>{step}</span>
            {isComplete ? <CheckCircle2 aria-hidden="true" size={14} /> : null}
            {isActive ? <Loader2 aria-hidden="true" className="spin" size={14} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function runProgressIndex(status: string): number {
  const normalized = status.toLowerCase();

  if (normalized.includes("workbook complete")) {
    return runProgressSteps.length;
  }

  if (normalized.includes("writing output")) {
    return 6;
  }

  if (normalized.includes("building url")) {
    return 5;
  }

  if (normalized.includes("reading ean")) {
    return 4;
  }

  if (normalized.includes("reading orders")) {
    return 3;
  }

  if (normalized.includes("loading excel")) {
    return 2;
  }

  if (
    normalized.includes("worker") ||
    normalized.includes("processor") ||
    normalized.includes("retrying once") ||
    normalized.includes("compatibility mode")
  ) {
    return 1;
  }

  return 0;
}

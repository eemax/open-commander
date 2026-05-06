import {
  URL_GENERATOR_SCRIPT_ID,
  type ProcessingIssue,
  type RunStageId,
  type UploadedScriptFile,
  type UrlGeneratorRunResult,
} from "../scripts/urlGenerator/types";

type WorkerSuccess = {
  type: "success";
  result: UrlGeneratorRunResult;
};

type WorkerFailure = {
  type: "error";
  kind: "input-issues" | "runtime";
  message: string;
  issues?: ProcessingIssue[];
};

type WorkerStage = {
  type: "stage";
  stage: RunStageId;
};

type WorkerResponse = WorkerSuccess | WorkerFailure | WorkerStage;

export type WorkerRun<T> = {
  promise: Promise<T>;
  cancel: () => void;
};

type WorkerRunOptions = {
  onStage?: (stage: RunStageId) => void;
};

export class WorkerRunError extends Error {
  readonly kind: WorkerFailure["kind"];
  readonly issues: ProcessingIssue[];
  readonly lastStage: RunStageId | null;

  constructor(failure: WorkerFailure, lastStage: RunStageId | null = null) {
    super(failure.message);
    this.name = "WorkerRunError";
    this.kind = failure.kind;
    this.issues = failure.issues ?? [];
    this.lastStage = lastStage;
  }
}

export class WorkerUnexpectedError extends Error {
  readonly lastStage: RunStageId | null;

  constructor(message: string, lastStage: RunStageId | null) {
    super(message);
    this.name = "WorkerUnexpectedError";
    this.lastStage = lastStage;
  }
}

export function createUrlGeneratorWorkerRun(
  files: UploadedScriptFile[],
  options: WorkerRunOptions = {},
): WorkerRun<UrlGeneratorRunResult> {
  let worker: Worker;
  let lastStage: RunStageId | null = null;

  try {
    worker = new Worker(new URL("../workers/scriptRunner.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch (error) {
    return rejectedWorkerRun(
      new WorkerUnexpectedError(
        `The workbook worker could not start. ${formatUnknownError(error)}`,
        lastStage,
      ),
    );
  }

  let settled = false;
  let rejectRun: (reason?: unknown) => void = () => {};

  const promise = new Promise<UrlGeneratorRunResult>((resolve, reject) => {
    rejectRun = reject;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (settled) {
        return;
      }

      if (event.data.type === "stage") {
        lastStage = event.data.stage;
        options.onStage?.(event.data.stage);
        return;
      }

      settled = true;
      worker.terminate();

      if (event.data.type === "success") {
        resolve(event.data.result);
        return;
      }

      reject(new WorkerRunError(event.data, lastStage));
    };

    worker.onerror = (event) => {
      if (settled) {
        return;
      }

      settled = true;
      worker.terminate();
      reject(new WorkerUnexpectedError(formatWorkerErrorEvent(event), lastStage));
    };

    worker.onmessageerror = () => {
      if (settled) {
        return;
      }

      settled = true;
      worker.terminate();
      reject(
        new WorkerUnexpectedError(
          "The workbook worker returned a response this browser could not read.",
          lastStage,
        ),
      );
    };

    try {
      worker.postMessage(
        {
          type: "run",
          scriptId: URL_GENERATOR_SCRIPT_ID,
          files,
        },
        files.map((file) => file.buffer),
      );
    } catch (error) {
      settled = true;
      worker.terminate();
      reject(
        new WorkerUnexpectedError(
          `The workbook worker could not receive the files. ${formatUnknownError(
            error,
          )}`,
          lastStage,
        ),
      );
    }
  });

  return {
    promise,
    cancel: () => {
      if (settled) {
        return;
      }

      settled = true;
      worker.terminate();
      rejectRun(new DOMException("Run canceled.", "AbortError"));
    },
  };
}

function rejectedWorkerRun<T>(error: Error): WorkerRun<T> {
  return {
    promise: Promise.reject(error),
    cancel: () => {},
  };
}

function formatWorkerErrorEvent(event: ErrorEvent): string {
  const details = [
    event.message || "The worker stopped unexpectedly.",
    event.filename ? `File: ${event.filename}` : "",
    event.lineno ? `Line: ${event.lineno}` : "",
    event.colno ? `Column: ${event.colno}` : "",
    event.error ? formatUnknownError(event.error) : "",
  ].filter(Boolean);

  return details.join(" ");
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return "Unknown error.";
}

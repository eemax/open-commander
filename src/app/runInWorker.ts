import {
  URL_GENERATOR_SCRIPT_ID,
  type ProcessingIssue,
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

type WorkerResponse = WorkerSuccess | WorkerFailure;

export type WorkerRun<T> = {
  promise: Promise<T>;
  cancel: () => void;
};

export class WorkerRunError extends Error {
  readonly kind: WorkerFailure["kind"];
  readonly issues: ProcessingIssue[];

  constructor(failure: WorkerFailure) {
    super(failure.message);
    this.name = "WorkerRunError";
    this.kind = failure.kind;
    this.issues = failure.issues ?? [];
  }
}

export function createUrlGeneratorWorkerRun(
  files: UploadedScriptFile[],
): WorkerRun<UrlGeneratorRunResult> {
  let worker: Worker;

  try {
    worker = new Worker(new URL("../workers/scriptRunner.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch (error) {
    return rejectedWorkerRun(
      new Error(`The workbook worker could not start. ${formatUnknownError(error)}`),
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

      settled = true;
      worker.terminate();

      if (event.data.type === "success") {
        resolve(event.data.result);
        return;
      }

      reject(new WorkerRunError(event.data));
    };

    worker.onerror = (event) => {
      if (settled) {
        return;
      }

      settled = true;
      worker.terminate();
      reject(new Error(formatWorkerErrorEvent(event)));
    };

    worker.onmessageerror = () => {
      if (settled) {
        return;
      }

      settled = true;
      worker.terminate();
      reject(
        new Error(
          "The workbook worker returned a response this browser could not read.",
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
        new Error(
          `The workbook worker could not receive the files. ${formatUnknownError(
            error,
          )}`,
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

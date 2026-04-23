import {
  URL_GENERATOR_SCRIPT_ID,
  type UploadedScriptFile,
  type UrlGeneratorRunResult,
} from "../scripts/urlGenerator/types";

type WorkerSuccess = {
  type: "success";
  result: UrlGeneratorRunResult;
};

type WorkerFailure = {
  type: "error";
  message: string;
};

type WorkerResponse = WorkerSuccess | WorkerFailure;

export type WorkerRun<T> = {
  promise: Promise<T>;
  cancel: () => void;
};

export function createUrlGeneratorWorkerRun(
  files: UploadedScriptFile[],
): WorkerRun<UrlGeneratorRunResult> {
  const worker = new Worker(new URL("../workers/scriptRunner.worker.ts", import.meta.url), {
    type: "module",
  });
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

      reject(new Error(event.data.message));
    };

    worker.onerror = (event) => {
      if (settled) {
        return;
      }

      settled = true;
      worker.terminate();
      reject(new Error(event.message || "The worker stopped unexpectedly."));
    };

    worker.postMessage(
      {
        type: "run",
        scriptId: URL_GENERATOR_SCRIPT_ID,
        files,
      },
      files.map((file) => file.buffer),
    );
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

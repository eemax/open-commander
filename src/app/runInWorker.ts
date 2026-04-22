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

export function runUrlGeneratorInWorker(
  files: UploadedScriptFile[],
): Promise<UrlGeneratorRunResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/scriptRunner.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      worker.terminate();

      if (event.data.type === "success") {
        resolve(event.data.result);
        return;
      }

      reject(new Error(event.data.message));
    };

    worker.onerror = (event) => {
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
}

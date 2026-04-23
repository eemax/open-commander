import {
  FatalInputIssueError,
  runUrlGenerator,
} from "../scripts/urlGenerator/excel";
import {
  URL_GENERATOR_SCRIPT_ID,
  type ProcessingIssue,
  type UploadedScriptFile,
  type UrlGeneratorRunResult,
} from "../scripts/urlGenerator/types";

type RunMessage = {
  type: "run";
  scriptId: typeof URL_GENERATOR_SCRIPT_ID;
  files: UploadedScriptFile[];
};

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

self.onmessage = async (event: MessageEvent<RunMessage>) => {
  try {
    if (event.data.type !== "run" || event.data.scriptId !== URL_GENERATOR_SCRIPT_ID) {
      throw new Error("Unknown script request.");
    }

    const result = await runUrlGenerator(event.data.files);
    const response: WorkerSuccess = { type: "success", result };
    self.postMessage(response, [result.outputBuffer]);
  } catch (error) {
    const response: WorkerFailure =
      error instanceof FatalInputIssueError
        ? {
            type: "error",
            kind: "input-issues",
            message: error.message,
            issues: error.issues,
          }
        : {
            type: "error",
            kind: "runtime",
            message:
              error instanceof Error
                ? error.message
                : "The workbook could not be processed.",
          };

    self.postMessage(response);
  }
};

export {};

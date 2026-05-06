import {
  URL_GENERATOR_SCRIPT_ID,
  type ProcessingIssue,
  type RunStageId,
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

type WorkerStage = {
  type: "stage";
  stage: RunStageId;
};

self.onmessage = async (event: MessageEvent<RunMessage>) => {
  let FatalInputIssueErrorClass:
    | typeof import("../scripts/urlGenerator/excel").FatalInputIssueError
    | null = null;

  try {
    postStage("worker-started");

    if (event.data.type !== "run" || event.data.scriptId !== URL_GENERATOR_SCRIPT_ID) {
      throw new Error("Unknown script request.");
    }

    postStage("loading-excel-engine");
    const { FatalInputIssueError, runUrlGenerator } = await import(
      "../scripts/urlGenerator/excel"
    );
    FatalInputIssueErrorClass = FatalInputIssueError;
    const result = await runUrlGenerator(event.data.files, { onStage: postStage });
    postStage("complete");
    const response: WorkerSuccess = { type: "success", result };
    self.postMessage(response, [result.outputBuffer]);
  } catch (error) {
    const response: WorkerFailure =
      FatalInputIssueErrorClass && error instanceof FatalInputIssueErrorClass
        ? {
            type: "error",
            kind: "input-issues",
            message: error.message,
            issues: error.issues,
          }
        : {
            type: "error",
            kind: "runtime",
            message: formatUnknownError(error),
          };

    self.postMessage(response);
  }
};

function postStage(stage: RunStageId): void {
  const message: WorkerStage = { type: "stage", stage };
  self.postMessage(message);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return "The workbook could not be processed.";
}

export {};

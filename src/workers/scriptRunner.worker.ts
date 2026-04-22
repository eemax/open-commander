import { runUrlGenerator } from "../scripts/urlGenerator/excel";
import {
  URL_GENERATOR_SCRIPT_ID,
  type UploadedScriptFile,
  type UrlGeneratorRunOptions,
  type UrlGeneratorRunResult,
} from "../scripts/urlGenerator/types";

type RunMessage = {
  type: "run";
  scriptId: typeof URL_GENERATOR_SCRIPT_ID;
  files: UploadedScriptFile[];
  options: UrlGeneratorRunOptions;
};

type WorkerSuccess = {
  type: "success";
  result: UrlGeneratorRunResult;
};

type WorkerFailure = {
  type: "error";
  message: string;
};

self.onmessage = async (event: MessageEvent<RunMessage>) => {
  try {
    if (event.data.type !== "run" || event.data.scriptId !== URL_GENERATOR_SCRIPT_ID) {
      throw new Error("Unknown script request.");
    }

    const result = await runUrlGenerator(event.data.files, event.data.options);
    const response: WorkerSuccess = { type: "success", result };
    self.postMessage(response, [result.outputBuffer]);
  } catch (error) {
    const response: WorkerFailure = {
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "The workbook could not be processed.",
    };
    self.postMessage(response);
  }
};

export {};

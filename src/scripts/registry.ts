import {
  MAX_FILE_SIZE_BYTES,
  URL_GENERATOR_SCRIPT_ID,
} from "./urlGenerator/types";

export type ScriptDefinition = {
  id: string;
  name: string;
  inputLabel: string;
  summary: string;
  maxFileSizeBytes: number;
  acceptedExtensions: string[];
};

export const scripts: ScriptDefinition[] = [
  {
    id: URL_GENERATOR_SCRIPT_ID,
    name: "URL Generator",
    inputLabel: "Orders + EANs",
    summary: "Create URL workbooks from matching orders and EAN files.",
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    acceptedExtensions: [".xlsx"],
  },
];

export const defaultScript = scripts[0];

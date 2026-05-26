import type { FileRole, ProcessingIssue } from "../scripts/urlGenerator/types";

export type LocalWorkbookFile = {
  id: string;
  file: File;
  detectedRole: FileRole | null;
};

export type RoleSelection = {
  ordersId: string;
  eansId: string;
};

export type Notice = {
  id: string;
  message: string;
};

export type RunFailure = {
  title: string;
  summary: string;
  nextSteps: string[];
  issues: ProcessingIssue[];
  details?: string;
  canUseCompatibilityMode?: boolean;
};

export type SelectedWorkbookFiles = {
  orders: LocalWorkbookFile;
  eans: LocalWorkbookFile;
};

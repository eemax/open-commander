import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  HelpCircle,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createUrlGeneratorWorkerRun,
  WorkerUnexpectedError,
  WorkerRunError,
  type WorkerRun,
} from "./runInWorker";
import { readFileAsArrayBuffer } from "../lib/file";
import { createLocalId } from "../lib/id";
import { scripts } from "../scripts/registry";
import {
  detectRoleFromFileName,
  isXlsxFileName,
} from "../scripts/urlGenerator/fileRoles";
import {
  MAX_FILE_SIZE_BYTES,
  type UploadedScriptFile,
  type UrlGeneratorRunResult,
} from "../scripts/urlGenerator/types";
import { BrandLogo } from "./BrandLogo";
import { ThemeModeControl } from "./ThemeModeControl";
import { ScriptSelector } from "./ScriptSelector";
import { UrlGeneratorHelpModal } from "./UrlGeneratorHelpModal";
import { RunProgress } from "./RunProgress";
import { RunFailureView } from "./RunFailureView";
import {
  ResultView,
  resultStatusClassName,
  resultStatusLabel,
} from "./ResultView";
import {
  autoSelectRoles,
  emptySelection,
  fileKey,
  formatBytes,
  roleLabel,
} from "./fileSelection";
import { describeRunFailure } from "./runFailure";
import { formatRunStage, formatWorkerAttemptStatus } from "./runStatus";
import {
  applyThemeMode,
  readStoredThemeMode,
  type ThemeMode,
  writeStoredThemeMode,
} from "./theme";
import type {
  LocalWorkbookFile,
  Notice,
  RoleSelection,
  RunFailure,
  SelectedWorkbookFiles,
} from "./types";

export function App() {
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const [files, setFiles] = useState<LocalWorkbookFile[]>([]);
  const [selection, setSelection] = useState<RoleSelection>(emptySelection);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runStatus, setRunStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<UrlGeneratorRunResult | null>(null);
  const [runFailure, setRunFailure] = useState<RunFailure | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(readStoredThemeMode);
  const activeRunRef = useRef<WorkerRun<UrlGeneratorRunResult> | null>(null);
  const runVersionRef = useRef(0);

  useEffect(() => {
    return () => {
      activeRunRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    applyThemeMode(themeMode);
    writeStoredThemeMode(themeMode);

    if (themeMode !== "auto") {
      return;
    }

    if (!window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => applyThemeMode(themeMode);

    mediaQuery.addEventListener("change", update);

    return () => {
      mediaQuery.removeEventListener("change", update);
    };
  }, [themeMode]);

  useEffect(() => {
    if (!isHelpOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsHelpOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isHelpOpen]);

  const selectedFiles = useMemo(
    () => ({
      orders: files.find((item) => item.id === selection.ordersId),
      eans: files.find((item) => item.id === selection.eansId),
    }),
    [files, selection],
  );

  const canRun =
    Boolean(selectedFiles.orders && selectedFiles.eans) &&
    selection.ordersId !== selection.eansId &&
    !isRunning;

  const validationMessages = useMemo(() => {
    const messages: string[] = [];

    if (files.length === 0) {
      return messages;
    }

    if (!selectedFiles.orders) {
      messages.push("Choose an orders workbook.");
    }

    if (!selectedFiles.eans) {
      messages.push("Choose an EAN/UPC workbook.");
    }

    if (
      selection.ordersId &&
      selection.eansId &&
      selection.ordersId === selection.eansId
    ) {
      messages.push("Orders and EAN/UPC data must use different workbooks.");
    }

    return messages;
  }, [files.length, selectedFiles, selection]);

  function cancelCurrentRun() {
    runVersionRef.current += 1;
    activeRunRef.current?.cancel();
    activeRunRef.current = null;
    setIsRunning(false);
    setRunStatus("");
  }

  function addFiles(fileList: FileList | File[]) {
    cancelCurrentRun();

    const incoming = Array.from(fileList);
    const accepted: LocalWorkbookFile[] = [];
    const nextNotices: Notice[] = [];

    for (const file of incoming) {
      if (!isXlsxFileName(file.name)) {
        nextNotices.push({
          id: createLocalId(),
          message: `${file.name} is not an .xlsx file.`,
        });
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        nextNotices.push({
          id: createLocalId(),
          message: `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(
            MAX_FILE_SIZE_BYTES,
          )}.`,
        });
        continue;
      }

      accepted.push({
        id: createLocalId(),
        file,
        detectedRole: detectRoleFromFileName(file.name).role,
      });
    }

    const acceptedKeys = new Set(accepted.map((item) => fileKey(item.file)));
    const nextFiles = [
      ...files.filter((item) => !acceptedKeys.has(fileKey(item.file))),
      ...accepted,
    ];

    setFiles(nextFiles);
    setSelection(autoSelectRoles(nextFiles, selection));
    setNotices(nextNotices);
    setResult(null);
    setRunFailure(null);
    setError("");
    setRunStatus("");
  }

  function removeFile(id: string) {
    cancelCurrentRun();

    const nextFiles = files.filter((item) => item.id !== id);
    setFiles(nextFiles);
    setSelection(autoSelectRoles(nextFiles, {
      ordersId: selection.ordersId === id ? "" : selection.ordersId,
      eansId: selection.eansId === id ? "" : selection.eansId,
    }));
    setResult(null);
    setRunFailure(null);
    setError("");
    setRunStatus("");
  }

  async function runSelectedScript() {
    if (!selectedFiles.orders || !selectedFiles.eans) {
      setRunFailure(null);
      setError("Choose one orders workbook and one EAN/UPC workbook.");
      return;
    }

    if (selectedFiles.orders.id === selectedFiles.eans.id) {
      setRunFailure(null);
      setError("Orders and EAN/UPC data must use different workbooks.");
      return;
    }

    setIsRunning(true);
    setError("");
    setResult(null);
    setRunFailure(null);
    setRunStatus("Reading workbook files");
    let runVersion: number | null = null;

    try {
      runVersion = runVersionRef.current + 1;
      runVersionRef.current = runVersion;
      const runFiles: SelectedWorkbookFiles = {
        orders: selectedFiles.orders,
        eans: selectedFiles.eans,
      };
      const response = await runWithWorkerRetry(runFiles, runVersion);

      if (runVersionRef.current !== runVersion) {
        return;
      }

      setResult(response);
      setRunFailure(null);
    } catch (runError) {
      if (runVersion !== null && runVersionRef.current !== runVersion) {
        return;
      }

      if (
        runError instanceof DOMException &&
        runError.name === "AbortError"
      ) {
        return;
      }

      setError("");
      setRunFailure(describeRunFailure(runError));
    } finally {
      if (runVersion === null || runVersionRef.current === runVersion) {
        activeRunRef.current = null;
        setIsRunning(false);
        setRunStatus("");
      }
    }
  }

  async function runCompatibilityMode() {
    if (!selectedFiles.orders || !selectedFiles.eans) {
      setRunFailure(null);
      setError("Choose one orders workbook and one EAN/UPC workbook.");
      return;
    }

    if (selectedFiles.orders.id === selectedFiles.eans.id) {
      setRunFailure(null);
      setError("Orders and EAN/UPC data must use different workbooks.");
      return;
    }

    setIsRunning(true);
    setError("");
    setResult(null);
    setRunFailure(null);
    setRunStatus("Reading workbook files");
    let runVersion: number | null = null;

    try {
      runVersion = runVersionRef.current + 1;
      runVersionRef.current = runVersion;
      const runFiles: SelectedWorkbookFiles = {
        orders: selectedFiles.orders,
        eans: selectedFiles.eans,
      };
      const uploadedFiles = await readSelectedWorkbookFiles(runFiles);

      assertCurrentRun(runVersion);
      setRunStatus("Loading Excel engine in compatibility mode");
      const { FatalInputIssueError, runUrlGenerator } = await import(
        "../scripts/urlGenerator/excel"
      );

      try {
        const response = await runUrlGenerator(uploadedFiles, {
          onStage: (stage) => setRunStatus(formatRunStage(stage, "compatibility")),
        });

        assertCurrentRun(runVersion);
        setResult(response);
        setRunFailure(null);
      } catch (runError) {
        if (runError instanceof FatalInputIssueError) {
          throw new WorkerRunError({
            type: "error",
            kind: "input-issues",
            message: runError.message,
            issues: runError.issues,
          });
        }

        throw runError;
      }
    } catch (runError) {
      if (runVersion !== null && runVersionRef.current !== runVersion) {
        return;
      }

      if (
        runError instanceof DOMException &&
        runError.name === "AbortError"
      ) {
        return;
      }

      setError("");
      setRunFailure(describeRunFailure(runError, { compatibilityTried: true }));
    } finally {
      if (runVersion === null || runVersionRef.current === runVersion) {
        activeRunRef.current = null;
        setIsRunning(false);
        setRunStatus("");
      }
    }
  }

  async function runWithWorkerRetry(
    runFiles: SelectedWorkbookFiles,
    runVersion: number,
  ): Promise<UrlGeneratorRunResult> {
    const maxAttempts = 2;
    let lastRecoverableError: WorkerUnexpectedError | WorkerRunError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      assertCurrentRun(runVersion);
      setRunStatus(
        attempt === 1
          ? "Reading workbook files"
          : "The browser could not finish background processing. Retrying once.",
      );
      const uploadedFiles = await readSelectedWorkbookFiles(runFiles);

      assertCurrentRun(runVersion);
      setRunStatus(formatWorkerAttemptStatus(attempt, "Starting workbook processor"));
      const workerRun = createUrlGeneratorWorkerRun(uploadedFiles, {
        onStage: (stage) => setRunStatus(formatRunStage(stage, "worker", attempt)),
      });
      activeRunRef.current = workerRun;

      try {
        return await workerRun.promise;
      } catch (runError) {
        activeRunRef.current = null;

        if (isRecoverableWorkerFailure(runError)) {
          lastRecoverableError = runError;

          if (attempt < maxAttempts) {
            continue;
          }
        }

        throw runError;
      }
    }

    throw lastRecoverableError ?? new Error("The workbook processor stopped unexpectedly.");
  }

  function isRecoverableWorkerFailure(
    error: unknown,
  ): error is WorkerUnexpectedError | WorkerRunError {
    return (
      error instanceof WorkerUnexpectedError ||
      (error instanceof WorkerRunError && error.kind === "runtime")
    );
  }

  async function readSelectedWorkbookFiles(
    runFiles: SelectedWorkbookFiles,
  ): Promise<UploadedScriptFile[]> {
    const [ordersBuffer, eansBuffer] = await Promise.all([
      readFileAsArrayBuffer(runFiles.orders.file),
      readFileAsArrayBuffer(runFiles.eans.file),
    ]);

    return [
      {
        role: "orders",
        fileName: runFiles.orders.file.name,
        buffer: ordersBuffer,
      },
      {
        role: "eans",
        fileName: runFiles.eans.file.name,
        buffer: eansBuffer,
      },
    ];
  }

  function assertCurrentRun(runVersion: number): void {
    if (runVersionRef.current !== runVersion) {
      throw new DOMException("Run canceled.", "AbortError");
    }
  }

  function resetWorkspace() {
    cancelCurrentRun();
    setFiles([]);
    setSelection(emptySelection);
    setNotices([]);
    setResult(null);
    setRunFailure(null);
    setError("");
    setRunStatus("");
  }

  function openScript(scriptId: string) {
    if (activeScriptId && activeScriptId !== scriptId) {
      resetWorkspace();
    }
    setActiveScriptId(scriptId);
  }

  function backToScripts() {
    cancelCurrentRun();
    setIsHelpOpen(false);
    setActiveScriptId(null);
  }

  const activeScript =
    scripts.find((script) => script.id === activeScriptId) ?? null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">
          <BrandLogo />
          <span>Open Commander</span>
        </div>
        <div className="topbar-actions">
          <div className="local-badge" title="Files are processed in this browser">
            <ShieldCheck aria-hidden="true" size={18} />
            <span>Local processing</span>
          </div>
          <ThemeModeControl mode={themeMode} onChange={setThemeMode} />
        </div>
      </header>

      <main className="workspace">
        {activeScript ? (
          <>
            <div className="workspace-heading">
              <div className="title-row">
                <button
                  className="icon-button back-icon"
                  type="button"
                  onClick={backToScripts}
                  title="Back to scripts"
                  aria-label="Back to scripts"
                >
                  <ArrowLeft aria-hidden="true" size={17} />
                </button>
                <h1 className="script-title-line">
                  <span>{activeScript.name}</span>
                  <span aria-hidden="true">/</span>
                  <span>{activeScript.inputLabel}</span>
                </h1>
              </div>
              <div className="workspace-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setIsHelpOpen(true)}
                  title="Help"
                >
                  <HelpCircle aria-hidden="true" size={17} />
                  <span>Help</span>
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={resetWorkspace}
                  title="Reset"
                >
                  <RotateCcw aria-hidden="true" size={17} />
                  <span>Reset</span>
                </button>
              </div>
            </div>

            <div className="tool-grid">
              <section
                className="control-panel"
                aria-label={`${activeScript.name} controls`}
                aria-busy={isRunning}
              >
                <div className="section-title">
                  <h2>Inputs</h2>
                  <span>{files.length === 1 ? "1 file" : `${files.length} files`}</span>
                </div>

                <label
                  className={`dropzone ${isDragging ? "is-dragging" : ""}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragging(false);
                    addFiles(event.dataTransfer.files);
                  }}
                >
                  <input
                    type="file"
                    accept=".xlsx"
                    multiple
                    disabled={isRunning}
                    onChange={(event) => {
                      if (event.target.files) {
                        addFiles(event.target.files);
                      }
                      event.currentTarget.value = "";
                    }}
                  />
                  <UploadCloud aria-hidden="true" size={24} />
                  <span>Choose .xlsx files</span>
                  <small>Drop files here or click to browse</small>
                  <small>5 MB max per file</small>
                </label>

                <div className="template-actions" aria-label="Template downloads">
                  <a
                    className="template-link"
                    href="/templates/url-generator-orders-template.xlsx"
                    download
                  >
                    <Download aria-hidden="true" size={16} />
                    <span>Orders template</span>
                  </a>
                  <a
                    className="template-link"
                    href="/templates/url-generator-eans-template.xlsx"
                    download
                  >
                    <Download aria-hidden="true" size={16} />
                    <span>EAN/UPC template</span>
                  </a>
                </div>

                {notices.length > 0 && (
                  <div className="notice-stack" aria-live="polite">
                    {notices.map((notice) => (
                      <div className="notice" key={notice.id}>
                        <AlertTriangle aria-hidden="true" size={16} />
                        <span>{notice.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="file-list" aria-label="Selected files">
                  {files.length === 0 ? (
                    <div className="empty-file-list">No files added</div>
                  ) : (
                    files.map((item) => (
                      <div className="file-row" key={item.id}>
                        <FileSpreadsheet aria-hidden="true" size={20} />
                        <div>
                          <strong>{item.file.name}</strong>
                          <div className="file-meta">
                            <span>{formatBytes(item.file.size)}</span>
                            <span
                              className={`role-badge ${
                                item.detectedRole ? "" : "role-badge-muted"
                              }`}
                            >
                              {item.detectedRole
                                ? roleLabel(item.detectedRole)
                                : "Role not detected"}
                            </span>
                          </div>
                        </div>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => removeFile(item.id)}
                          title="Remove file"
                          aria-label={`Remove ${item.file.name}`}
                        >
                          <X aria-hidden="true" size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className={`role-grid ${files.length === 0 ? "role-grid-empty" : ""}`}>
                  <div className="role-grid-title">
                    <h2>Confirm files</h2>
                    <span>Match each workbook role</span>
                  </div>
                  <label
                    className={
                      selection.ordersId ? "role-field role-field-selected" : "role-field"
                    }
                  >
                    <span>Orders workbook</span>
                    <select
                      value={selection.ordersId}
                      disabled={isRunning}
                      onChange={(event) =>
                        setSelection((current) => ({
                          ...current,
                          ordersId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Choose file</option>
                      {files.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.file.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    className={
                      selection.eansId ? "role-field role-field-selected" : "role-field"
                    }
                  >
                    <span>EAN/UPC workbook</span>
                    <select
                      value={selection.eansId}
                      disabled={isRunning}
                      onChange={(event) =>
                        setSelection((current) => ({
                          ...current,
                          eansId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Choose file</option>
                      {files.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.file.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {validationMessages.length > 0 && (
                  <div className="validation-list" role="status">
                    {validationMessages.map((message) => (
                      <div key={message}>{message}</div>
                    ))}
                  </div>
                )}

                {error && (
                  <div className="error-box" role="alert">
                    <AlertTriangle aria-hidden="true" size={18} />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  className="run-button"
                  type="button"
                  disabled={!canRun}
                  onClick={runSelectedScript}
                >
                  {isRunning ? (
                    <Loader2 aria-hidden="true" className="spin" size={18} />
                  ) : (
                    <Play aria-hidden="true" size={18} />
                  )}
                  <span>{isRunning ? "Running" : "Run script"}</span>
                </button>
                {isRunning && (
                  <button
                    className="secondary-button cancel-run-button"
                    type="button"
                    onClick={cancelCurrentRun}
                  >
                    Cancel
                  </button>
                )}
              </section>

              <section
                className={`result-panel ${
                  !isRunning && !result && !runFailure
                    ? "result-panel-prerun"
                    : ""
                }`}
                aria-label="Run result"
                aria-busy={isRunning}
              >
                <div className="section-title">
                  <h2>Output</h2>
                  {result ? (
                    <span className={resultStatusClassName(result)}>
                      {resultStatusLabel(result)}
                    </span>
                  ) : isRunning ? (
                    <span className="status-pill status-running">Running</span>
                  ) : runFailure ? (
                    <span className="status-pill status-error">Run failed</span>
                  ) : null}
                </div>
                {result ? (
                  <ResultView result={result} />
                ) : runFailure ? (
                  <RunFailureView
                    failure={runFailure}
                    isRunning={isRunning}
                    onTryCompatibility={
                      runFailure.canUseCompatibilityMode
                        ? runCompatibilityMode
                        : () => undefined
                    }
                  />
                ) : (
                  <div className="result-empty">
                    {isRunning ? (
                      <Loader2 aria-hidden="true" className="spin" size={28} />
                    ) : (
                      <CheckCircle2 aria-hidden="true" size={28} />
                    )}
                    <h3>{isRunning ? "Working" : "No output yet"}</h3>
                    <p>
                      {isRunning
                        ? runStatus || "Processing workbook files in this browser."
                        : "Generated workbook appears here."}
                    </p>
                    {isRunning ? <RunProgress status={runStatus} /> : null}
                  </div>
                )}
              </section>
            </div>

            {isHelpOpen ? (
              <UrlGeneratorHelpModal onClose={() => setIsHelpOpen(false)} />
            ) : null}
          </>
        ) : (
          <ScriptSelector scripts={scripts} onOpen={openScript} />
        )}
      </main>
    </div>
  );
}

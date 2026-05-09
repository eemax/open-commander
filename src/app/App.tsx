import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSpreadsheet,
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
import { downloadArrayBuffer } from "../lib/download";
import { readFileAsArrayBuffer } from "../lib/file";
import { createLocalId } from "../lib/id";
import { scripts, type ScriptDefinition } from "../scripts/registry";
import {
  detectRoleFromFileName,
  isXlsxFileName,
} from "../scripts/urlGenerator/fileRoles";
import {
  MAX_FILE_SIZE_BYTES,
  type FileRole,
  type ProcessingIssue,
  type RunStageId,
  type UploadedScriptFile,
  type UrlGeneratorRunResult,
} from "../scripts/urlGenerator/types";

type LocalWorkbookFile = {
  id: string;
  file: File;
  detectedRole: FileRole | null;
};

type RoleSelection = {
  ordersId: string;
  eansId: string;
};

type Notice = {
  id: string;
  message: string;
};

type RunFailure = {
  title: string;
  summary: string;
  nextSteps: string[];
  issues: ProcessingIssue[];
  details?: string;
  canUseCompatibilityMode?: boolean;
};

type SelectedWorkbookFiles = {
  orders: LocalWorkbookFile;
  eans: LocalWorkbookFile;
};

const emptySelection: RoleSelection = {
  ordersId: "",
  eansId: "",
};

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
  const activeRunRef = useRef<WorkerRun<UrlGeneratorRunResult> | null>(null);
  const runVersionRef = useRef(0);

  useEffect(() => {
    return () => {
      activeRunRef.current?.cancel();
    };
  }, []);

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
      messages.push("Choose an EAN workbook.");
    }

    if (
      selection.ordersId &&
      selection.eansId &&
      selection.ordersId === selection.eansId
    ) {
      messages.push("Orders and EANs must use different workbooks.");
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
      setError("Choose one orders workbook and one EAN workbook.");
      return;
    }

    if (selectedFiles.orders.id === selectedFiles.eans.id) {
      setRunFailure(null);
      setError("Orders and EANs must use different workbooks.");
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
      setError("Choose one orders workbook and one EAN workbook.");
      return;
    }

    if (selectedFiles.orders.id === selectedFiles.eans.id) {
      setRunFailure(null);
      setError("Orders and EANs must use different workbooks.");
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
    setActiveScriptId(null);
  }

  const activeScript =
    scripts.find((script) => script.id === activeScriptId) ?? null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">
          <FileSpreadsheet aria-hidden="true" size={24} />
          <span>Open Commander</span>
        </div>
        <div className="local-badge" title="Files are processed in this browser">
          <ShieldCheck aria-hidden="true" size={18} />
          <span>Local processing</span>
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
                    <span>EAN template</span>
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

                <div className="role-grid">
                  <label>
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
                  <label>
                    <span>EAN workbook</span>
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
                className="result-panel"
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
                    onRunCompatibilityMode={
                      runFailure.canUseCompatibilityMode
                        ? runCompatibilityMode
                        : undefined
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
          </>
        ) : (
          <ScriptSelector scripts={scripts} onSelect={openScript} />
        )}
      </main>
    </div>
  );
}

function ScriptSelector({
  scripts,
  onSelect,
}: {
  scripts: ScriptDefinition[];
  onSelect: (scriptId: string) => void;
}) {
  return (
    <div className="home-view">
      <div className="home-toolbar">
        <h1 className="home-title">Scripts</h1>
        <span className="script-count">{scripts.length} available</span>
      </div>

      <div className="script-grid" aria-label="Available scripts">
        {scripts.map((script) => (
          <button
            className="script-card"
            type="button"
            key={script.id}
            onClick={() => onSelect(script.id)}
          >
            <span className="script-card-icon">
              <FileSpreadsheet aria-hidden="true" size={22} />
            </span>
            <span className="script-card-body">
              <strong>{script.name}</strong>
              <span>{script.summary}</span>
              <small>
                {script.inputLabel} · {script.acceptedExtensions.join(", ")} ·{" "}
                {formatBytes(script.maxFileSizeBytes)}
              </small>
            </span>
            <ChevronRight aria-hidden="true" size={20} />
          </button>
        ))}
      </div>
    </div>
  );
}

function RunProgress({ status }: { status: string }) {
  const activeIndex = runProgressIndex(status);

  return (
    <div className="run-progress" aria-label="Run progress">
      {runProgressSteps.map((step, index) => {
        const state =
          activeIndex > index
            ? "complete"
            : activeIndex === index
              ? "active"
              : "waiting";

        return (
          <div className={`run-progress-step run-progress-${state}`} key={step}>
            <span className="run-progress-dot" aria-hidden="true" />
            <span>{step}</span>
          </div>
        );
      })}
    </div>
  );
}

function RunFailureView({
  failure,
  isRunning,
  onRunCompatibilityMode,
}: {
  failure: RunFailure;
  isRunning: boolean;
  onRunCompatibilityMode?: () => void;
}) {
  const shownIssues = failure.issues.slice(0, 8);

  return (
    <div className="run-failure" role="alert">
      <div className="run-failure-hero">
        <AlertTriangle aria-hidden="true" size={26} />
        <div>
          <h3>{failure.title}</h3>
          <p>{failure.summary}</p>
        </div>
      </div>

      <div className="failure-guidance">
        <strong>What needs to change</strong>
        <ul className="failure-list">
          {failure.nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
        {onRunCompatibilityMode ? (
          <div className="failure-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={isRunning}
              onClick={onRunCompatibilityMode}
            >
              {isRunning ? (
                <Loader2 aria-hidden="true" className="spin" size={17} />
              ) : (
                <Play aria-hidden="true" size={17} />
              )}
              <span>{isRunning ? "Running" : "Try compatibility mode"}</span>
            </button>
          </div>
        ) : null}
      </div>

      {shownIssues.length > 0 ? (
        <div className="issues">
          <div className="issues-heading">
            <AlertTriangle aria-hidden="true" size={18} />
            <h3>Rows to fix</h3>
          </div>
          <IssueTable issues={shownIssues} />
          {failure.issues.length > shownIssues.length && (
            <p className="issue-footnote">
              {failure.issues.length - shownIssues.length} more error
              {failure.issues.length - shownIssues.length === 1 ? "" : "s"} to
              fix.
            </p>
          )}
        </div>
      ) : failure.details ? (
        <div className="failure-details">
          <strong>Error details</strong>
          <p>{failure.details}</p>
        </div>
      ) : null}
    </div>
  );
}

function ResultView({ result }: { result: UrlGeneratorRunResult }) {
  const shownIssues = result.issues.slice(0, 8);
  const issueSummary = summarizeIssues(result.issues);
  const successSummary = formatSuccessSummary(result);

  return (
    <div className="result-content">
      <div className="result-header">
        <div>
          <h3>{result.outputFileName}</h3>
          <p>{successSummary}</p>
          {issueSummary ? <small>{issueSummary}</small> : null}
        </div>
        <button
          className="download-button"
          type="button"
          onClick={() =>
            downloadArrayBuffer(
              result.outputBuffer,
              result.outputFileName,
              result.mimeType,
            )
          }
        >
          <Download aria-hidden="true" size={18} />
          <span>Download</span>
        </button>
      </div>

      <div className="stat-grid">
        <Stat label="URLs" value={result.stats.urlsCreated} />
        <Stat label="Orders" value={result.stats.ordersRead} />
        <Stat label="EANs" value={result.stats.eansRead} />
        <Stat label="Unmatched" value={result.stats.unmatchedOrders} />
      </div>

      <ResultPreview rows={result.previewRows} />

      <div className="detected-grid">
        {result.detectedTables.map((table) => (
          <div className="detected-row" key={table.fileRole}>
            <strong>{roleLabel(table.fileRole)}</strong>
            <span>
              {table.headerRowNumber
                ? `Header row ${table.headerRowNumber}`
                : "No matching header row"}
            </span>
            <small>
              {table.columns
                .map((column) => `${column.label} ${column.columnName}`)
                .join(" · ")}
            </small>
          </div>
        ))}
      </div>

      {shownIssues.length > 0 && (
        <div className="issues">
          <div className="issues-heading">
            <AlertTriangle aria-hidden="true" size={18} />
            <h3>Issues</h3>
          </div>
          <IssueTable issues={shownIssues} />
          {result.issues.length > shownIssues.length && (
            <p className="issue-footnote">
              {result.issues.length - shownIssues.length} more issue
              {result.issues.length - shownIssues.length === 1 ? "" : "s"} in the
              workbook.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ResultPreview({ rows }: { rows: UrlGeneratorRunResult["previewRows"] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="result-preview">
      <div className="preview-heading">
        <h3>Preview</h3>
        <span>First {rows.length} generated rows</span>
      </div>
      <div className="preview-table" aria-label="Generated URL preview">
        <div className="preview-row preview-head">
          <span>Purchase order</span>
          <span>Product</span>
          <span>SKU</span>
          <span>EAN</span>
          <span>URL</span>
        </div>
        {rows.map((row) => (
          <div
            className="preview-row"
            key={`${row.purchase_order}-${row.product}-${row.ean}`}
          >
            <span>{row.purchase_order}</span>
            <span>{row.product}</span>
            <span>{row.sku || "-"}</span>
            <span>{row.ean}</span>
            <span>{row.url}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IssueTable({ issues }: { issues: ProcessingIssue[] }) {
  return (
    <div className="issue-table">
      {issues.map((issue, index) => (
        <div className="issue-row" key={`${issue.message}-${index}`}>
          <strong>{issue.severity}</strong>
          <span>{formatIssueSource(issue)}</span>
          <span>{formatIssueLocation(issue)}</span>
          <p>{issue.message}</p>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function resultStatusLabel(result: UrlGeneratorRunResult): string {
  const counts = countIssues(result.issues);

  if (counts.error > 0) {
    return "Completed with errors";
  }

  if (counts.warning > 0) {
    return "Ready with warnings";
  }

  return "Ready";
}

function resultStatusClassName(result: UrlGeneratorRunResult): string {
  const counts = countIssues(result.issues);

  if (counts.error > 0) {
    return "status-pill status-error";
  }

  if (counts.warning > 0) {
    return "status-pill status-warning";
  }

  return "status-pill status-ready";
}

function summarizeIssues(issues: UrlGeneratorRunResult["issues"]): string {
  const counts = countIssues(issues);
  const parts = [
    counts.error > 0 ? `${counts.error} error${counts.error === 1 ? "" : "s"}` : "",
    counts.warning > 0
      ? `${counts.warning} warning${counts.warning === 1 ? "" : "s"}`
      : "",
    counts.info > 0 ? `${counts.info} note${counts.info === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  return parts.join(", ");
}

function countIssues(issues: UrlGeneratorRunResult["issues"]) {
  return issues.reduce(
    (counts, issue) => ({
      ...counts,
      [issue.severity]: counts[issue.severity] + 1,
    }),
    { error: 0, warning: 0, info: 0 },
  );
}

const runProgressSteps = [
  "Read files",
  "Start processor",
  "Load Excel",
  "Read orders",
  "Read EANs",
  "Build URLs",
  "Write workbook",
];

function runProgressIndex(status: string): number {
  const normalized = status.toLowerCase();

  if (normalized.includes("workbook complete")) {
    return runProgressSteps.length;
  }

  if (normalized.includes("writing output")) {
    return 6;
  }

  if (normalized.includes("building url")) {
    return 5;
  }

  if (normalized.includes("reading ean")) {
    return 4;
  }

  if (normalized.includes("reading orders")) {
    return 3;
  }

  if (normalized.includes("loading excel")) {
    return 2;
  }

  if (
    normalized.includes("worker") ||
    normalized.includes("processor") ||
    normalized.includes("retrying once") ||
    normalized.includes("compatibility mode")
  ) {
    return 1;
  }

  return 0;
}

function formatSuccessSummary(result: UrlGeneratorRunResult): string {
  const urls = result.stats.urlsCreated.toLocaleString();
  const orders = result.stats.ordersRead.toLocaleString();
  const eans = result.stats.eansRead.toLocaleString();
  const unmatched = result.stats.unmatchedOrders;
  const unmatchedText =
    unmatched > 0
      ? ` ${unmatched.toLocaleString()} order${
          unmatched === 1 ? " has" : "s have"
        } no matching EAN product.`
      : " Every order matched at least one EAN product.";

  return `Created ${urls} URL${result.stats.urlsCreated === 1 ? "" : "s"} from ${orders} order row${
    result.stats.ordersRead === 1 ? "" : "s"
  } and ${eans} EAN row${result.stats.eansRead === 1 ? "" : "s"}.${unmatchedText}`;
}

function formatWorkerAttemptStatus(attempt: number, status: string): string {
  return attempt === 1 ? status : `Retry ${attempt - 1}: ${status}`;
}

function formatRunStage(
  stage: RunStageId,
  mode: "worker" | "compatibility" | "details",
  attempt = 1,
): string {
  const label = runStageLabel(stage);

  if (mode === "details") {
    return label;
  }

  if (mode === "compatibility") {
    return `Compatibility mode: ${label}`;
  }

  return formatWorkerAttemptStatus(attempt, label);
}

function runStageLabel(stage: RunStageId): string {
  switch (stage) {
    case "worker-started":
      return "Workbook processor started";
    case "loading-excel-engine":
      return "Loading Excel engine";
    case "reading-orders-workbook":
      return "Reading orders workbook";
    case "reading-eans-workbook":
      return "Reading EAN workbook";
    case "building-urls":
      return "Building URLs";
    case "writing-output-workbook":
      return "Writing output workbook";
    case "complete":
      return "Workbook complete";
  }
}

function describeRunFailure(
  error: unknown,
  options: { compatibilityTried?: boolean } = {},
): RunFailure {
  if (error instanceof WorkerRunError && error.kind === "input-issues") {
    const issues = error.issues.filter((issue) => issue.severity === "error");

    if (issues.length > 0) {
      const errorCount = issues.length;

      return {
        title: "Input data needs changes",
        summary: `The workbook data needs to be fixed before Open Commander can create an output. ${errorCount.toLocaleString()} input ${
          errorCount === 1 ? "error was" : "errors were"
        } found.`,
        nextSteps: buildInputFailureSteps(issues),
        issues,
      };
    }
  }

  if (options.compatibilityTried) {
    return {
      title: "Compatibility mode could not complete",
      summary:
        "The browser still could not finish this workbook run. The files may still be valid.",
      nextSteps: [
        "Try the same files in Google Chrome.",
        "If Chrome also fails, send the workbook pair for review.",
      ],
      issues: [],
      details: formatRuntimeDetails(error),
    };
  }

  if (error instanceof WorkerUnexpectedError) {
    return {
      title: "The browser stopped the workbook processor",
      summary:
        "Open Commander retried the background workbook processor once, but the browser stopped it before completion.",
      nextSteps: [
        "Try compatibility mode. It may make this tab feel busy briefly while it runs.",
        "If compatibility mode also fails, try the same files in Google Chrome.",
      ],
      issues: [],
      details: formatUnexpectedWorkerDetails(error),
      canUseCompatibilityMode: true,
    };
  }

  if (error instanceof WorkerRunError && error.kind === "runtime") {
    return {
      title: "Workbook processor could not complete",
      summary:
        "Open Commander retried the background workbook processor once, but the browser still could not finish the run.",
      nextSteps: [
        "Try compatibility mode. It may make this tab feel busy briefly while it runs.",
        "If compatibility mode also fails, try the same files in Google Chrome.",
      ],
      issues: [],
      details: formatWorkerRuntimeDetails(error),
      canUseCompatibilityMode: true,
    };
  }

  const message =
    error instanceof Error ? error.message : "The files could not be processed.";

  return {
    title: "Run could not complete",
    summary: "The browser could not create an output workbook from these files.",
    nextSteps: [
      "Check that both selected files are valid .xlsx workbooks and are not password-protected.",
      "Upload the corrected files and run the script again.",
    ],
    issues: [],
    details: message,
  };
}

function formatUnexpectedWorkerDetails(error: WorkerUnexpectedError): string {
  const lastStage = error.lastStage
    ? formatRunStage(error.lastStage, "details")
    : "The processor stopped before reporting a stage.";

  return `Last stage: ${lastStage}. Error: ${error.message}. Browser: ${navigator.userAgent}`;
}

function formatWorkerRuntimeDetails(error: WorkerRunError): string {
  const lastStage = error.lastStage
    ? formatRunStage(error.lastStage, "details")
    : "The processor did not report a stage.";

  return `Last stage: ${lastStage}. Error: ${error.message}. Browser: ${navigator.userAgent}`;
}

function formatRuntimeDetails(error: unknown): string {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return `${message}. Browser: ${navigator.userAgent}`;
}

function buildInputFailureSteps(issues: ProcessingIssue[]): string[] {
  const messages = issues.map((issue) => issue.message.toLowerCase());
  const fields = new Set(issues.map((issue) => issue.field).filter(Boolean));
  const hasBaseUrlIssue =
    fields.has("base_url") || messages.some((message) => message.includes("base url"));
  const hasDuplicateIssue = messages.some((message) =>
    message.includes("duplicate"),
  );
  const hasMissingRequiredIssue = messages.some(
    (message) =>
      message.includes("mandatory field") ||
      message.includes("required column") ||
      message.includes("no usable data rows"),
  );
  const hasEanFormatIssue = messages.some(
    (message) =>
      message.includes("ean contains") || message.includes("ean must"),
  );
  const steps = [
    "Edit the listed rows in the source workbook, save the file, then upload the corrected workbook.",
  ];

  if (hasMissingRequiredIssue) {
    steps.push(
      "Orders need purchase_order, product, and base_url. EANs need product and ean; sku is optional.",
    );
  }

  if (hasBaseUrlIssue) {
    steps.push(
      "Base URL values must be https root domains like https://example.com; replace template placeholders before generating and remove paths such as /product, query strings, and http:// values.",
    );
  }

  if (hasDuplicateIssue) {
    steps.push(
      "Make duplicate purchase order/product combinations, EANs, and SKUs unique.",
    );
  }

  if (hasEanFormatIssue) {
    steps.push(
      "EAN values must contain digits only. Format the source column as text when leading zeroes matter.",
    );
  }

  steps.push("Run the script again after the source data is corrected.");

  return steps;
}

function formatIssueSource(issue: ProcessingIssue): string {
  const source =
    issue.fileName ?? (issue.fileRole ? roleLabel(issue.fileRole) : "output");

  return issue.sheetName ? `${source} · ${issue.sheetName}` : source;
}

function formatIssueLocation(issue: ProcessingIssue): string {
  const parts = [
    issue.rowNumber ? `Row ${issue.rowNumber}` : "",
    issue.field ?? "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "Workbook";
}

function autoSelectRoles(
  files: LocalWorkbookFile[],
  current: RoleSelection,
): RoleSelection {
  const hasCurrentOrders = files.some((item) => item.id === current.ordersId);
  const hasCurrentEans = files.some((item) => item.id === current.eansId);
  const ordersId =
    hasCurrentOrders
      ? current.ordersId
      : files.find((item) => item.detectedRole === "orders")?.id ?? "";
  const eansId =
    hasCurrentEans
      ? current.eansId
      : files.find((item) => item.detectedRole === "eans")?.id ?? "";

  return {
    ordersId,
    eansId: eansId === ordersId ? "" : eansId,
  };
}

function fileKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function roleLabel(role: FileRole): string {
  return role === "orders" ? "Orders" : "EANs";
}

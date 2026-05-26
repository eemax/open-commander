import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";

import { MAX_FATAL_ISSUES_SHOWN } from "./constants";
import { IssueTable } from "./ResultView";
import type { RunFailure } from "./types";

export function RunFailureView({
  failure,
  isRunning,
  onTryCompatibility,
}: {
  failure: RunFailure;
  isRunning: boolean;
  onTryCompatibility: () => void;
}) {
  const shownIssues = failure.issues.slice(0, MAX_FATAL_ISSUES_SHOWN);

  return (
    <div className="run-failure" role="alert">
      <div className="run-failure-hero">
        <AlertTriangle aria-hidden="true" size={24} />
        <div>
          <h3>{failure.title}</h3>
          <p>{failure.summary}</p>
        </div>
      </div>
      <div className="failure-guidance">
        <strong>Next steps</strong>
        <ul className="failure-list">
          {failure.nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
        {failure.canUseCompatibilityMode ? (
          <div className="failure-actions">
            <button
              className="secondary-button"
              disabled={isRunning}
              onClick={onTryCompatibility}
              type="button"
            >
              {isRunning ? (
                <Loader2 aria-hidden="true" className="spin" size={17} />
              ) : (
                <RotateCcw aria-hidden="true" size={17} />
              )}
              <span>Try compatibility mode</span>
            </button>
          </div>
        ) : null}
      </div>

      {shownIssues.length > 0 ? (
        <div className="issues">
          <div className="issues-heading">
            <AlertTriangle aria-hidden="true" size={18} />
            <h3>
              Input errors <span>{failure.issues.length.toLocaleString()}</span>
            </h3>
          </div>
          <IssueTable issues={shownIssues} />
          {failure.issues.length > shownIssues.length ? (
            <p className="issue-footnote">
              Showing the first {shownIssues.length} of{" "}
              {failure.issues.length} input errors. Fix these and
              run again to continue validation.
            </p>
          ) : null}
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

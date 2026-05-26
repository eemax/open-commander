import { ChevronRight, FileSpreadsheet } from "lucide-react";

import type { ScriptDefinition } from "../scripts/registry";

export function ScriptSelector({
  scripts,
  onOpen,
}: {
  scripts: ScriptDefinition[];
  onOpen: (scriptId: string) => void;
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
            key={script.id}
            onClick={() => onOpen(script.id)}
            type="button"
          >
            <span className="script-card-icon">
              <FileSpreadsheet aria-hidden="true" size={24} />
            </span>
            <span className="script-card-body">
              <strong>{script.name}</strong>
              <span>{script.summary}</span>
              <small>{script.inputLabel}</small>
            </span>
            <ChevronRight aria-hidden="true" size={20} />
          </button>
        ))}
      </div>
    </div>
  );
}

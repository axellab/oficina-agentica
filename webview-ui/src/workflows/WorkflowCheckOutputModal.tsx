import { useRef } from 'react';

import { Button } from '../components/ui/Button.js';
import { Modal } from '../components/ui/Modal.js';
import { type CheckOutputView, closeCheckOutput, useCheckOutput } from './workflowStore.js';
import { checkLine } from './workflowView.js';

interface WorkflowCheckOutputModalProps {
  /** Ask the server again (a Check still running has written more since). */
  onRefresh: (crewId: string, stageId: string) => void;
}

/**
 * The Check of one stage of a Workflow run as the office ran it
 * (`workflowCheckOutput`, asked for from the stage's row): the command, the
 * folder it ran in, how it went, and what it wrote. The evidence a stage was
 * closed on, or was not. Mounted at App's top level, so both shells show it.
 */
export function WorkflowCheckOutputModal({ onRefresh }: WorkflowCheckOutputModalProps) {
  const view = useCheckOutput();
  // Keep the last one on screen while the dialog drops away.
  const last = useRef<CheckOutputView | null>(view);
  if (view) last.current = view;
  const shown = view ?? last.current;
  if (!shown) return null;
  const { output } = shown;

  return (
    <Modal
      isOpen={view !== null}
      onClose={closeCheckOutput}
      title={output?.name ? `Check: ${output.name}` : 'Check'}
    >
      <div
        data-testid="workflow-check-output"
        data-check-state={output?.state}
        className="flex flex-col gap-6 px-10 py-4 w-[min(90vw,720px)]"
      >
        {output ? (
          <>
            <p className="m-0 text-xs text-text-muted break-words">
              {checkLine({
                id: shown.stageId,
                name: output.name ?? shown.stageId,
                state: output.state,
                ...(output.exitCode !== undefined ? { exitCode: output.exitCode } : {}),
                ...(output.seconds !== undefined ? { seconds: output.seconds } : {}),
              })}
            </p>
            {output.command && (
              <p className="m-0 text-xs break-all" data-testid="workflow-check-command">
                <span className="text-text-muted">Ran </span>
                {output.command}
                {output.directory && (
                  <>
                    <span className="text-text-muted"> in </span>
                    {output.directory}
                  </>
                )}
              </p>
            )}
            {output.truncated && (
              <p className="m-0 text-xs text-text-muted">Showing the end of a longer output.</p>
            )}
            <pre
              className="m-0 p-6 text-xs bg-bg-dark border-2 border-border overflow-auto max-h-[50vh] whitespace-pre-wrap break-words"
              data-testid="workflow-check-output-text"
            >
              {output.output || 'It wrote no output.'}
            </pre>
          </>
        ) : (
          <p className="m-0 text-sm text-text-muted">Asking the office...</p>
        )}
        <div className="flex justify-end gap-6">
          {output?.state === 'running' && (
            <Button
              variant="default"
              size="sm"
              onClick={() => onRefresh(shown.crewId, shown.stageId)}
            >
              Refresh
            </Button>
          )}
          <Button variant="accent" size="sm" onClick={closeCheckOutput}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

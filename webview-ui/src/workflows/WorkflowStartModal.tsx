import { useEffect, useRef, useState } from 'react';

import { MAX_WORKFLOW_REQUEST_CHARS } from '../../../core/src/workflows.js';
import { Button } from '../components/ui/Button.js';
import { Modal } from '../components/ui/Modal.js';
import { PixelText } from '../components/ui/PixelText.js';
import { WORKFLOW_REQUEST_ROWS } from '../constants.js';
import type { WorkflowAsking } from './useWorkflowStart.js';
import { numberedStages, requestProblem, stageMarksTitle } from './workflowView.js';

interface WorkflowStartModalProps {
  /** The Workflow picked in the drawer and the Directory pressed; null while shut. */
  asking: WorkflowAsking | null;
  /** Start the run with the request as written (trimmed). */
  onSubmit: (request: string) => void;
  onClose: () => void;
}

/**
 * The request a Workflow run starts from: what the Workflow is for, where it
 * will run and who leads it, its stages with the Role that owns each (stages
 * that run at the same time share a number), and the user's own words. Start
 * launches the lead with a Crew; nothing launches before it. Mounted at App's
 * top level, so both shells show it.
 */
export function WorkflowStartModal({ asking, onSubmit, onClose }: WorkflowStartModalProps) {
  // Keep the last one on screen while the dialog drops away.
  const last = useRef(asking);
  if (asking) last.current = asking;
  const shown = asking ?? last.current;

  return (
    <Modal
      isOpen={asking !== null}
      onClose={onClose}
      title={shown?.workflow.name ?? 'Workflow'}
      className="w-[min(440px,100%)]"
    >
      {shown && (
        <RequestForm
          // A new pick starts from an empty request.
          key={`${shown.workflow.id}:${shown.directory.path}`}
          asking={shown}
          onSubmit={onSubmit}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function RequestForm({
  asking,
  onSubmit,
  onClose,
}: {
  asking: WorkflowAsking;
  onSubmit: (request: string) => void;
  onClose: () => void;
}) {
  const { workflow, directory } = asking;
  const [request, setRequest] = useState('');
  const [tried, setTried] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const problem = requestProblem(request);
  const submit = () => {
    setTried(true);
    if (problem) return;
    onSubmit(request.trim());
  };

  return (
    <div data-testid="workflow-start-modal" className="flex flex-col gap-8 px-10 py-4">
      {workflow.description && <p className="m-0 text-sm">{workflow.description}</p>}
      <p className="m-0 text-xs text-text-muted" data-testid="workflow-start-where">
        Runs in {directory.name}, led by {workflow.leadRoleName || 'its lead'} with a Crew: the
        agents each stage needs are launched as it goes, and work together without asking you.
      </p>

      <ol
        className="list-none m-0 flex flex-col gap-2 text-sm border-2 border-border py-4 px-8"
        data-testid="workflow-start-stages"
      >
        {numberedStages(workflow).map((stage) => (
          <li
            key={stage.id}
            className="flex items-baseline gap-8 min-w-0"
            title={stageMarksTitle(stage)}
            data-stage-id={stage.id}
          >
            <span className="shrink-0 w-12 text-text-muted">
              <PixelText text={`${stage.step}`} />
            </span>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{stage.title}</span>
            <span className="shrink-0 text-xs text-text-muted">{stage.roleName}</span>
            {stage.required && (
              <span className="shrink-0 text-xs text-warning" data-testid="workflow-start-required">
                required
              </span>
            )}
            {stage.check && (
              <span
                className="shrink-0 text-xs text-status-active"
                data-testid="workflow-start-check"
              >
                check: {stage.check}
              </span>
            )}
          </li>
        ))}
      </ol>

      <label className="flex flex-col gap-2 text-xs text-text-muted">
        Your request
        <textarea
          ref={inputRef}
          data-testid="workflow-request-input"
          value={request}
          rows={WORKFLOW_REQUEST_ROWS}
          placeholder="What do you need? Say it as you would to a colleague."
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => {
            // Enter writes a new line; with Ctrl or Cmd it starts the run.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
          className="text-sm py-2 px-4 bg-bg border-2 border-border rounded-none text-text resize-y"
        />
      </label>
      <div className="flex items-center justify-between gap-8 -mt-4 text-xs min-h-16">
        {tried && problem ? (
          <span role="alert" className="text-danger">
            {problem}
          </span>
        ) : (
          <span />
        )}
        <span className="shrink-0 text-text-muted">
          <PixelText text={`${request.trim().length} / ${MAX_WORKFLOW_REQUEST_CHARS}`} />
        </span>
      </div>

      <div className="flex items-center justify-end gap-8 pt-4">
        <Button variant="default" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="accent" size="sm" data-testid="workflow-start" onClick={submit}>
          Start
        </Button>
      </div>
    </div>
  );
}

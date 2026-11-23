import { useRef } from 'react';

import { Button } from '../components/ui/Button.js';
import { Modal } from '../components/ui/Modal.js';
import { dismissWorkflowRejection, useWorkflowRejection } from './workflowStore.js';

/**
 * A Workflow start this office asked for that the server refused
 * (`workflowRejected`): no run started, and this says why (the Pixel Office
 * MCP is off, the lead could not launch, the Workflow left the host's list).
 * Mounted at App's top level, so both shells show it.
 */
export function WorkflowRejectedModal() {
  const rejected = useWorkflowRejection();
  // Keep the last reason on screen while the dialog drops away.
  const last = useRef(rejected);
  if (rejected) last.current = rejected;
  const shown = rejected ?? last.current;
  if (!shown) return null;

  return (
    <Modal
      isOpen={rejected !== null}
      onClose={dismissWorkflowRejection}
      title="Couldn't start the workflow"
    >
      <div data-testid="workflow-rejected" className="flex flex-col gap-8 px-10 py-4 max-w-md">
        <p role="alert" className="text-sm m-0 break-words">
          {shown.reason}
        </p>
        <div className="flex justify-end">
          <Button variant="accent" size="sm" onClick={dismissWorkflowRejection}>
            OK
          </Button>
        </div>
      </div>
    </Modal>
  );
}

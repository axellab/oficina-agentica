import { useCallback, useState } from 'react';

import type { Workflow } from '../../../core/src/messages.js';
import type { Directory } from '../hooks/useExtensionMessages.js';
import { transport } from '../transport/index.js';
import { workflowsLoaded } from './workflowStore.js';

/** A Workflow picked in the drawer and the Directory pressed, waiting for the request. */
export interface WorkflowAsking {
  workflow: Workflow;
  directory: Directory;
  /** The roster pick or the row's mug shot: what the lead wears. */
  palette?: number;
}

/**
 * Starting a Workflow run: the drawer's pick and the Directory pressed open
 * the request dialog (`open`); Start sends `startWorkflow` with what the user
 * wrote and tells the terminal drawer a launch is coming (`expectLaunch`), so
 * the lead's terminal opens focused. A start the server refuses is answered
 * `workflowRejected` (workflowStore), which its own dialog shows.
 */
export function useWorkflowStart(expectLaunch: () => void) {
  const [asking, setAsking] = useState<WorkflowAsking | null>(null);

  const open = useCallback((workflowId: string, directory: Directory, palette?: number) => {
    // As the server lists it now: one the list no longer holds starts nothing.
    const workflow = workflowsLoaded()?.workflows.find((w) => w.id === workflowId);
    if (workflow) setAsking({ workflow, directory, palette });
  }, []);

  const close = useCallback(() => setAsking(null), []);

  const submit = useCallback(
    (request: string) => {
      if (!asking) return;
      expectLaunch();
      transport.send({
        type: 'startWorkflow',
        workflowId: asking.workflow.id,
        directoryPath: asking.directory.path,
        request,
        ...(asking.palette !== undefined ? { palette: asking.palette } : {}),
      });
      setAsking(null);
    },
    [asking, expectLaunch],
  );

  return { asking, open, close, submit };
}

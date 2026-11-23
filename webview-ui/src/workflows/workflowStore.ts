/**
 * The Workflows and their runs as the server last listed them
 * (`workflowsLoaded`), and a start it refused (`workflowRejected`), outside
 * React like crews/crewStore.ts: the launch drawer's Workflow row, the request
 * dialog and the Workflow panel read the same list with nothing threaded
 * through the shells' props. Null until the server sends one, and for good
 * where the office launches no agents itself (VS Code): no Workflow is offered
 * or shown there.
 */

import { useSyncExternalStore } from 'react';

import type { WorkflowsLoaded } from '../../../core/src/messages.js';
import { parseWorkflowsLoaded } from '../../../core/src/workflows.js';

/** A start this office asked for and the server refused. */
export interface WorkflowRejection {
  reason: string;
}

interface WorkflowStoreState {
  loaded: WorkflowsLoaded | null;
  rejected: WorkflowRejection | null;
}

let state: WorkflowStoreState = { loaded: null, rejected: null };
const listeners = new Set<() => void>();

function set(next: WorkflowStoreState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Take a Workflows message (useExtensionMessages). Returns whether it was
 *  one. A list that is not one leaves the last one standing. */
export function handleWorkflowsMessage(msg: { type?: unknown; [key: string]: unknown }): boolean {
  if (msg.type === 'workflowsLoaded') {
    const parsed = parseWorkflowsLoaded(msg);
    if (parsed) set({ ...state, loaded: parsed });
    return true;
  }
  if (msg.type === 'workflowRejected') {
    const reason = typeof msg.reason === 'string' && msg.reason ? msg.reason : 'It did not start.';
    set({ ...state, rejected: { reason } });
    return true;
  }
  return false;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The server's last list; the same object until a message replaces it. */
export function workflowsLoaded(): WorkflowsLoaded | null {
  return state.loaded;
}

/** The start the server refused, until it is dismissed. */
export function workflowRejection(): WorkflowRejection | null {
  return state.rejected;
}

/** The Workflows of this office and their runs, re-rendering when the server sends a new list. */
export function useWorkflows(): WorkflowsLoaded | null {
  return useSyncExternalStore(subscribe, workflowsLoaded);
}

/** The refused start, re-rendering when one arrives or is dismissed. */
export function useWorkflowRejection(): WorkflowRejection | null {
  return useSyncExternalStore(subscribe, workflowRejection);
}

export function dismissWorkflowRejection(): void {
  if (state.rejected) set({ ...state, rejected: null });
}

/** Tests only: forget the list and the rejection. */
export function resetWorkflowStoreForTests(): void {
  state = { loaded: null, rejected: null };
}

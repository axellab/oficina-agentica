/**
 * The Workflows and their runs as the server last listed them
 * (`workflowsLoaded`), a start it refused (`workflowRejected`) and the output
 * of a stage's Check this office asked for (`workflowCheckOutput`), outside
 * React like crews/crewStore.ts: the launch drawer's Workflow row, the request
 * dialog and the Workflow panel read the same list with nothing threaded
 * through the shells' props. Null until the server sends one, and for good
 * where the office launches no agents itself (VS Code): no Workflow is offered
 * or shown there.
 */

import { useSyncExternalStore } from 'react';

import type { WorkflowCheckOutput, WorkflowsLoaded } from '../../../core/src/messages.js';
import { parseWorkflowCheckOutput, parseWorkflowsLoaded } from '../../../core/src/workflows.js';

/** A start this office asked for and the server refused. */
export interface WorkflowRejection {
  reason: string;
}

/** The stage whose Check's output this office is looking at: what it asked
 *  for, and the server's answer once it came. */
export interface CheckOutputView {
  crewId: string;
  stageId: string;
  output: WorkflowCheckOutput | null;
}

interface WorkflowStoreState {
  loaded: WorkflowsLoaded | null;
  rejected: WorkflowRejection | null;
  checkOutput: CheckOutputView | null;
}

let state: WorkflowStoreState = { loaded: null, rejected: null, checkOutput: null };
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
  if (msg.type === 'workflowCheckOutput') {
    const parsed = parseWorkflowCheckOutput(msg);
    const asked = state.checkOutput;
    // Only the answer to what is on screen: one that comes after the dialog
    // shut, or for another stage, is dropped.
    if (parsed && asked && parsed.crewId === asked.crewId && parsed.stageId === asked.stageId) {
      set({ ...state, checkOutput: { ...asked, output: parsed } });
    }
    return true;
  }
  return false;
}

/** This office asks for a stage's Check output: the dialog opens, waiting. */
export function openCheckOutput(crewId: string, stageId: string): void {
  set({ ...state, checkOutput: { crewId, stageId, output: null } });
}

export function closeCheckOutput(): void {
  if (state.checkOutput) set({ ...state, checkOutput: null });
}

/** The Check output on screen, if any. */
export function checkOutputView(): CheckOutputView | null {
  return state.checkOutput;
}

/** The Check output on screen, re-rendering when it is asked for, answered or shut. */
export function useCheckOutput(): CheckOutputView | null {
  return useSyncExternalStore(subscribe, checkOutputView);
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
  state = { loaded: null, rejected: null, checkOutput: null };
}

import { useCallback } from 'react';

import { resumeConversation } from '../conversations/useConversations.js';
import { transport } from '../transport/index.js';
import type { WorktreeChoices } from '../worktrees/useNewWorktree.js';
import type { Directory } from './useExtensionMessages.js';

/** What the launch drawer chose for the agent besides its Directory and look. */
export interface LaunchAs {
  /** The Role picked in the drawer (absent = an agent with no Role). */
  roleId?: string;
  /** The drawer's Crew switch was on: the user starts a Crew with this agent. */
  crew?: boolean;
  /** The Workflow picked in the drawer: the press launches nothing yet, the
   *  surface asks for the request first (workflows/useWorkflowStart.ts). The
   *  Role and the Crew are then the Workflow's, not the drawer's. */
  workflowId?: string;
}

/**
 * Launching an agent and resuming a conversation, from either shell. Both
 * tell the terminal drawer first (`expectLaunch`), so the agent's terminal
 * opens focused once the server announces it.
 */
export function useLaunchActions(expectLaunch: () => void) {
  // palette: the character picked from the roster (absent = the Directory's
  // default characters, else a random pick, server-side). worktree: into a new
  // Worktree of the Directory's repo, named and based as the new-worktree
  // modal chose (a failed create answers worktreeRejected and opens no
  // terminal, so the launch latch just times out). launchAs: the Role picked
  // in the drawer and whether its Crew switch was on.
  const launch = useCallback(
    (directory: Directory, palette?: number, worktree?: WorktreeChoices, launchAs?: LaunchAs) => {
      expectLaunch();
      transport.send({
        type: 'launchAgent',
        directoryPath: directory.path,
        palette,
        roleId: launchAs?.roleId,
        ...(launchAs?.crew ? { crew: true } : {}),
        ...(worktree
          ? {
              worktree: true,
              worktreeName: worktree.name,
              ...(worktree.from ? { worktreeFrom: worktree.from } : {}),
            }
          : {}),
      });
    },
    [expectLaunch],
  );
  const resume = useCallback(
    (sessionId: string, directoryPath: string) => {
      expectLaunch();
      resumeConversation(sessionId, directoryPath);
    },
    [expectLaunch],
  );
  return { launch, resume };
}

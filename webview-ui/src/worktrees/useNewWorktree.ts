import { useCallback, useEffect, useState } from 'react';

import type { WorktreeBranch, WorktreeOptions } from '../../../core/src/messages.js';
import type { Directory } from '../hooks/useExtensionMessages.js';
import type { LaunchAs } from '../hooks/useLaunchActions.js';
import { transport } from '../transport/index.js';

/** What the user chose for a new Worktree: its name, and the branch to start
 *  from (absent = the Directory's own base setting). */
export interface WorktreeChoices {
  name: string;
  from?: WorktreeBranch;
}

interface Asking {
  directory: Directory;
  palette?: number;
  /** The Role picked in the drawer and its Crew switch, kept for the launch
   *  the modal ends in. */
  launchAs?: LaunchAs;
  /** null until the server's `worktreeOptions` arrives. */
  options: WorktreeOptions | null;
}

/**
 * The new-worktree modal's state: a row's worktree button opens it for its
 * Directory (wearing the roster pick, as the picked Role and starting a Crew,
 * if any) and asks the server for a name and the branches; Launch hands the
 * choices to `launch` and closes it. A
 * Directory the server can't offer one for is answered `worktreeRejected`,
 * which closes it too (the rejection modal says why).
 */
export function useNewWorktree(
  launch: (
    directory: Directory,
    palette: number | undefined,
    choices: WorktreeChoices,
    launchAs?: LaunchAs,
  ) => void,
) {
  const [asking, setAsking] = useState<Asking | null>(null);

  const open = useCallback((directory: Directory, palette?: number, launchAs?: LaunchAs) => {
    setAsking({ directory, palette, launchAs, options: null });
    transport.send({ type: 'requestWorktreeOptions', directoryPath: directory.path });
  }, []);

  const close = useCallback(() => setAsking(null), []);

  const askingPath = asking?.directory.path ?? null;
  useEffect(() => {
    if (askingPath === null) return;
    return transport.onMessage((msg) => {
      if (msg.type === 'worktreeOptions' && msg.directoryPath === askingPath) {
        setAsking((prev) =>
          prev && prev.directory.path === askingPath ? { ...prev, options: msg } : prev,
        );
      } else if (msg.type === 'worktreeRejected' && msg.directoryPath === askingPath) {
        setAsking((prev) => (prev && prev.options === null ? null : prev));
      }
    });
  }, [askingPath]);

  const submit = useCallback(
    (choices: WorktreeChoices) => {
      if (!asking) return;
      launch(asking.directory, asking.palette, choices, asking.launchAs);
      setAsking(null);
    },
    [asking, launch],
  );

  return { asking, open, close, submit };
}

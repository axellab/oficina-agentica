import { useState } from 'react';

import type {
  WorkflowRun,
  WorkflowRunStage,
  WorkflowStageState,
} from '../../../core/src/messages.js';
import { Button } from '../components/ui/Button.js';
import { PixelIcon } from '../components/ui/PixelIcon.js';
import { PixelText } from '../components/ui/PixelText.js';
import { AGENT_CARD_HEIGHT_PX, WORKFLOW_PANEL_WIDTH_PX } from '../constants.js';
import { panelCount, runProgress, STAGE_STATE_LABEL, stageTitle } from './workflowView.js';

interface WorkflowPanelProps {
  /** The runs under way (or finished and not yet stopped), in the order they were started. */
  runs: readonly WorkflowRun[];
  /** Stop a run, which ends its Crew. Absent where this office may not (a view-only one). */
  onStop?: (crewId: string) => void;
}

/** The panel's border (pixel-panel: 2px), inside the card's height. */
const BORDER_PX = 2;

/**
 * The Workflow runs, among the office's top-right panels (`OfficePanels`)
 * while one is under way: the request, and every stage with the Role that
 * owns it, where it stands and the note its lead closed it with. Collapsed to
 * its header (stages closed out of all of them) until opened, when it is as
 * tall as an agent card, like the tutorial's checklist above it and the Crews
 * under it. Stop Workflow is asked once, since it ends the run's Crew and
 * cannot be taken back. The work itself shows in the office: the lead walking
 * over to each agent it hands a stage to.
 */
export function WorkflowPanel({ runs, onStop }: WorkflowPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  if (runs.length === 0) return null;
  const single = runs.length === 1 ? runs[0] : undefined;

  return (
    <div
      className="shrink-0 pointer-events-auto pixel-panel px-10 text-sm"
      style={{ width: collapsed ? undefined : WORKFLOW_PANEL_WIDTH_PX, maxWidth: '100%' }}
      data-testid="workflow-panel"
    >
      <div
        className="flex items-center justify-between gap-10"
        style={{ height: AGENT_CARD_HEIGHT_PX - 2 * BORDER_PX }}
      >
        <span className="text-accent-bright flex items-center gap-6">
          <PixelIcon name="workflow" scale={1} />
          {single ? 'Workflow' : 'Workflows'}
          {/* One run: its stages closed against all of them. Several: how many runs. */}
          <PixelText text={panelCount(runs)} />
          {single?.finished && <span className="text-text-muted">finished</span>}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={collapsed ? 'Show the workflow' : 'Hide the workflow'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span
            aria-hidden
            className={`flex transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${collapsed ? '' : 'rotate-180'}`}
          >
            <PixelIcon name="down" scale={1} />
          </span>
        </Button>
      </div>

      {!collapsed &&
        runs.map((run) => (
          <RunSection key={run.crewId} run={run} counted={!single} onStop={onStop} />
        ))}
    </div>
  );
}

/** A stage's box: empty while to do, filled while in progress, ticked when
 *  done, struck when skipped. */
function StageBox({ state }: { state: WorkflowStageState }) {
  return (
    <span
      aria-hidden
      className="shrink-0 mt-2 w-14 h-14 border-2 border-current flex items-center justify-center"
    >
      {state === 'active' && <span className="w-6 h-6 bg-current" />}
      {state === 'done' && <PixelIcon name="check" scale={1} />}
      {state === 'skipped' && <span className="w-6 h-2 bg-current" />}
    </span>
  );
}

/** How a stage's row reads by its state: the one in progress stands out. */
const STAGE_ROW_CLASS: Record<WorkflowStageState, string> = {
  pending: 'text-text-muted',
  active: 'text-accent-bright',
  done: '',
  skipped: 'text-text-muted',
};

function StageRow({ stage }: { stage: WorkflowRunStage }) {
  return (
    <li
      className={`flex items-start gap-8 py-2 min-w-0 ${STAGE_ROW_CLASS[stage.state]}`}
      title={stageTitle(stage)}
      data-testid="workflow-stage"
      data-stage-id={stage.id}
      data-state={stage.state}
    >
      <StageBox state={stage.state} />
      <span className="flex flex-col min-w-0 leading-tight">
        <span className="flex items-baseline gap-6 min-w-0">
          <span
            className={`overflow-hidden text-ellipsis whitespace-nowrap ${stage.state === 'skipped' ? 'line-through' : ''}`}
          >
            {stage.title}
          </span>
          <span className="shrink-0 text-xs text-text-muted">{stage.roleName}</span>
        </span>
        <span className="sr-only">{STAGE_STATE_LABEL[stage.state]}</span>
        {stage.note && (
          <span
            className="text-xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap"
            data-testid="workflow-stage-note"
          >
            {stage.note}
          </span>
        )}
      </span>
    </li>
  );
}

interface RunSectionProps {
  run: WorkflowRun;
  /** Its own count beside its name: among several runs, the header counts the runs. */
  counted: boolean;
  onStop?: (crewId: string) => void;
}

function RunSection({ run, counted, onStop }: RunSectionProps) {
  const [confirmStop, setConfirmStop] = useState(false);

  return (
    <section
      className="border-t-2 border-border py-6 flex flex-col gap-6"
      data-testid="workflow-run"
      data-crew-id={run.crewId}
      data-workflow-id={run.workflowId}
      data-finished={run.finished ? 'true' : 'false'}
    >
      <div className="flex items-center justify-between gap-6">
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{run.name}</span>
        {counted && (
          <span className="shrink-0 flex items-center gap-6 text-xs text-text-muted">
            <PixelText text={runProgress(run)} />
            {run.finished && <span>finished</span>}
          </span>
        )}
      </div>
      {/* The user's own words, on one line as the server cut them; whole in the tooltip. */}
      <p
        className="m-0 text-xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap"
        title={run.request}
        data-testid="workflow-request"
      >
        {run.request}
      </p>

      <ol className="list-none m-0 pl-0 flex flex-col">
        {run.stages.map((stage) => (
          <StageRow key={stage.id} stage={stage} />
        ))}
      </ol>

      {onStop &&
        (confirmStop ? (
          <div className="flex flex-col gap-4">
            <span className="text-xs">
              Stop this workflow? Its agents keep running, but stop working with each other.
            </span>
            <div className="flex gap-6">
              <Button variant="default" size="sm" onClick={() => setConfirmStop(false)}>
                Keep Going
              </Button>
              <Button variant="accent" size="sm" onClick={() => onStop(run.crewId)}>
                Stop Workflow
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setConfirmStop(true)}>
              Stop Workflow
            </Button>
          </div>
        ))}
    </section>
  );
}

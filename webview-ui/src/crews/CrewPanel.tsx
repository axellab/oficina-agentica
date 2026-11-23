import { useState } from 'react';

import type { Crew } from '../../../core/src/messages.js';
import { Button } from '../components/ui/Button.js';
import { PixelIcon } from '../components/ui/PixelIcon.js';
import { PixelText } from '../components/ui/PixelText.js';
import {
  AGENT_CARD_HEIGHT_PX,
  CREW_EVENTS_MAX_HEIGHT_PX,
  CREW_MEMBER_INDENT_PX,
  CREW_MEMBER_MAX_INDENT_LEVELS,
  CREW_PANEL_WIDTH_PX,
} from '../constants.js';
import { crewAgentCount, crewEventLine, crewMemberTitle, crewRows } from './crewView.js';

interface CrewPanelProps {
  /** The Crews with an agent in the office, in the order they were started. */
  crews: readonly Crew[];
  /** The most agents one Crew holds at a time. */
  maxAgents: number;
  /** End a Crew. Absent where this office may not (a view-only one). */
  onEnd?: (crewId: string) => void;
}

/** The panel's border (pixel-panel: 2px), inside the card's height. */
const BORDER_PX = 2;

/**
 * The Crews, among the office's top-right panels (`OfficePanels`) while one
 * has agents: who is in each (every agent under the one that launched it),
 * what they did to each other lately, and End Crew, asked once since it cannot
 * be taken back. Collapsed to its header until opened, when it is as tall as
 * an agent card, like the tutorial's checklist it sits under. The office
 * itself shows the rest: a launch and a Message are a walk over to the other
 * agent's desk.
 */
export function CrewPanel({ crews, maxAgents, onEnd }: CrewPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  if (crews.length === 0) return null;
  const single = crews.length === 1 ? crews[0] : undefined;
  const agents = crewAgentCount(crews);

  return (
    <div
      className="shrink-0 pointer-events-auto pixel-panel px-10 text-sm"
      style={{ width: collapsed ? undefined : CREW_PANEL_WIDTH_PX, maxWidth: '100%' }}
      data-testid="crew-panel"
    >
      <div
        className="flex items-center justify-between gap-10"
        style={{ height: AGENT_CARD_HEIGHT_PX - 2 * BORDER_PX }}
      >
        <span className="text-accent-bright flex items-center gap-6">
          <PixelIcon name="crew" scale={1} />
          {single ? 'Crew' : 'Crews'}
          {/* One Crew: its agents against the most it holds. Several: all their agents. */}
          <PixelText text={single ? `${agents} / ${maxAgents}` : `${agents}`} />
          {single?.ended && <span className="text-text-muted">ended</span>}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={collapsed ? 'Show the Crew' : 'Hide the Crew'}
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
        crews.map((crew, index) => (
          <CrewSection
            key={crew.id}
            crew={crew}
            heading={single ? undefined : `Crew ${index + 1}`}
            maxAgents={maxAgents}
            onEnd={onEnd}
          />
        ))}
    </div>
  );
}

interface CrewSectionProps {
  crew: Crew;
  /** Its name among several; none where it is the only one (the header says it). */
  heading?: string;
  maxAgents: number;
  onEnd?: (crewId: string) => void;
}

function CrewSection({ crew, heading, maxAgents, onEnd }: CrewSectionProps) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  // Newest first: the list is short and the last thing done is what is asked about.
  const events = [...crew.events].reverse();

  return (
    <section
      className="border-t-2 border-border py-6 flex flex-col gap-6"
      data-testid="crew"
      data-crew-id={crew.id}
      data-ended={crew.ended ? 'true' : 'false'}
    >
      {heading && (
        <div className="flex items-center justify-between gap-6 text-xs text-text-muted">
          <span className="flex items-center gap-6">
            {heading}
            <PixelText text={`${crew.members.length} / ${maxAgents}`} />
          </span>
          {crew.ended && <span>ended</span>}
        </div>
      )}

      <ul className="list-none m-0 pl-0 flex flex-col gap-2 leading-tight">
        {crewRows(crew).map(({ member, depth }) => (
          <li
            key={member.agentId}
            className="flex items-baseline gap-6 min-w-0"
            style={{
              paddingLeft: Math.min(depth, CREW_MEMBER_MAX_INDENT_LEVELS) * CREW_MEMBER_INDENT_PX,
            }}
            title={crewMemberTitle(crew, member)}
            data-testid="crew-member"
            data-agent-id={member.agentId}
            data-launched-by={member.launchedBy}
          >
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{member.label}</span>
            {member.roleName && (
              <span className="text-xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap">
                {member.roleName}
              </span>
            )}
          </li>
        ))}
      </ul>

      {events.length > 0 && (
        <ol
          className="list-none m-0 pl-0 flex flex-col gap-4 overflow-y-auto overscroll-contain pixel-scrollbar text-xs leading-tight"
          style={{ maxHeight: CREW_EVENTS_MAX_HEIGHT_PX }}
          data-testid="crew-events"
        >
          {events.map((event, index) => (
            <li
              // Events carry no id: the time and the place in the list tell two apart.
              key={`${event.at}:${events.length - index}`}
              data-testid="crew-event"
              data-kind={event.kind}
              title={`${new Date(event.at).toLocaleTimeString()} · ${crewEventLine(event)}`}
            >
              <span className="block">{crewEventLine(event, crew)}</span>
              {event.gist && (
                <span className="block text-text-muted overflow-hidden text-ellipsis whitespace-nowrap">
                  {event.gist}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {crew.ended ? (
        <p className="m-0 text-xs text-text-muted">
          Its agents keep running on their own: they no longer launch, message or close each other.
        </p>
      ) : (
        onEnd &&
        (confirmEnd ? (
          <div className="flex flex-col gap-4">
            <span className="text-xs">
              End this Crew? Its agents keep running, but stop working with each other.
            </span>
            <div className="flex gap-6">
              <Button variant="default" size="sm" onClick={() => setConfirmEnd(false)}>
                Keep the Crew
              </Button>
              <Button variant="accent" size="sm" onClick={() => onEnd(crew.id)}>
                End Crew
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setConfirmEnd(true)}>
              End Crew
            </Button>
          </div>
        ))
      )}
    </section>
  );
}

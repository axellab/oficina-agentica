import type { ReactNode } from 'react';

import {
  CARD_BAR_TOP_PX,
  OFFICE_PANELS_EDGE_PX,
  OFFICE_PANELS_FOOT_ROOM_PX,
  OFFICE_PANELS_GAP_PX,
  OFFICE_PANELS_SHADOW_PX,
} from '../constants.js';

interface OfficePanelsProps {
  /** Pixels kept clear at the office's right edge (the desktop card bar overlaps it). */
  rightInset: number;
  children: ReactNode;
}

/**
 * The office's top-right panels (the tutorial's checklist, the Crews), one
 * under the other in the order given, level with the first agent card. They
 * are laid out, not placed one by one: a panel that opens pushes the ones
 * under it down instead of covering them, and the column ends above the
 * office's foot (the toolbar, the radio) and scrolls where the panels are
 * taller than that, so the last panel's buttons can always be reached.
 * Only the panels take the pointer: the office shows, and is pressed, round them.
 */
export function OfficePanels({ rightInset, children }: OfficePanelsProps) {
  return (
    <div
      className="absolute z-20 flex flex-col items-end overflow-y-auto overscroll-contain pixel-scrollbar pointer-events-none"
      style={{
        top: CARD_BAR_TOP_PX,
        // The panels' hard shadow is drawn inside the scrolling box, or it would be cut.
        right: OFFICE_PANELS_EDGE_PX + rightInset - OFFICE_PANELS_SHADOW_PX,
        paddingRight: OFFICE_PANELS_SHADOW_PX,
        paddingBottom: OFFICE_PANELS_SHADOW_PX,
        gap: OFFICE_PANELS_GAP_PX,
        maxWidth: 'calc(100% - 32px)',
        maxHeight: `calc(100% - ${CARD_BAR_TOP_PX + OFFICE_PANELS_FOOT_ROOM_PX}px)`,
      }}
      data-testid="office-panels"
    >
      {children}
    </div>
  );
}

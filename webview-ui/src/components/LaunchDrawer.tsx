import type { ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';

import type { Role, RoleColor } from '../../../core/src/messages.js';
import { LAUNCH_DRAWER_PENCIL_GAP_PX, ROLE_COLOR_HEX, ROLE_SWATCH_SIZE_PX } from '../constants.js';
import { useCrews } from '../crews/crewStore.js';
import { useDismiss } from '../hooks/useDismiss.js';
import type { Directory } from '../hooks/useExtensionMessages.js';
import type { LaunchAs } from '../hooks/useLaunchActions.js';
import { useLongPress } from '../hooks/useLongPress.js';
import { useRoles } from '../roles/roleStore.js';
import { DirectoryCharacterStrip } from './DirectoryCharacterStrip.js';
import type { RowButtonId } from './drawerRowButtons.js';
import { ROW_STACK_HIDDEN, rowButtonsFor, rowStackReducer } from './drawerRowButtons.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';
import { PixelIcon } from './ui/PixelIcon.js';
import type { PixelIconName } from './ui/pixelIcons.js';

interface LaunchDrawerProps {
  isOpen: boolean;
  directories: Directory[];
  /** Launch into the tapped Directory: as `palette` (the roster pick, or one
   *  of the row's mug shots pressed), else as the Directory's defaults (in
   *  its order) decide; into a new Worktree of its repo when `worktree` (the
   *  row's worktree button); and as `launchAs` says: the Role picked in the
   *  drawer (absent = no Role) and whether its Crew switch was on. The surface
   *  owns the send, because what else a launch does differs per surface
   *  (mobile also slides to the new terminal). */
  onSelect: (
    directory: Directory,
    palette?: number,
    worktree?: boolean,
    launchAs?: LaunchAs,
  ) => void;
  /** Open the Directory modal empty (the pinned `+ Directory` row). */
  onAddDirectory: () => void;
  /** Open the Directory modal pre-filled with this entry (user-defined rows). */
  onEditDirectory: (directory: Directory) => void;
  /** The character picked from the roster, when the drawer is asking where
   *  to launch it: its heading is pinned above `+ Directory`, and rows show
   *  only their names (the launch already has its character). */
  pick?: RosterPick;
  /** The Role row or the Crew switch was used: from here until it closes, the
   *  drawer is a question waiting for an answer (which Directory, for that
   *  Role or Crew), so a surface that shuts it when the pointer leaves should
   *  stop doing so. The rows also move under the pointer when the Roles show
   *  and hide. Called with false once the drawer has closed. */
  onHoldOpen?: (hold: boolean) => void;
  className?: string;
}

/** A roster pick waiting for its Directory (useRosterLaunch). */
export interface RosterPick {
  palette: number;
  heading: ReactNode;
}

/**
 * The launch button's drawer: one row per Directory an agent can be launched
 * into, with `+ Directory` pinned above them behind a separator. Opened by a
 * plain press of the launch button (and by hover on desktop), and rendered
 * above the button by the shared Dropdown. Every launch goes through a row
 * here — the button itself never launches.
 *
 * Rows arrive already ordered (host rows first, then user rows, each group
 * alphabetical) and already deduped: the union is built host-side, so every
 * office shows the same list in the same order.
 *
 * Only user-defined rows are editable — host-contributed rows (VS Code's
 * workspace folders, standalone's start directory) are the host's to define,
 * so they carry a badge and no pencil. A row that is a git repo (host rows
 * too) has the worktree button: an agent launched into a new Worktree. The badge is aria-hidden so a
 * row's accessible name stays the bare Directory name.
 *
 * A row is the main button (launch in the Directory's order) and its
 * default characters' mug shots (each launches as that character; the "..."
 * silhouette shows them all; the gaps launch in order, like the main button —
 * DirectoryCharacterStrip). A row's buttons (the pencil, on user rows) are
 * not part of the row at all: hovering the row shows them as a small stack
 * outside the drawer, hanging off its right border level with the row. Where
 * there is no hover a hovered stack is hidden (`pointer-coarse:`, which follows
 * the device, not the viewport) and a long press on the row reveals its stack
 * instead, until a press outside it (drawerRowButtons.ts).
 *
 * Where the host has Roles (roleStore), a Role row is pinned above
 * `+ Directory`: it names the Role the next launch gets ("None" until one is
 * picked) and, pressed, swaps the Directory rows for the Roles to pick from.
 * The pick lasts until the drawer closes, like a roster pick: a drawer opened
 * afresh launches plain agents, never as a Role chosen some time ago. A launch
 * into a new Worktree (a row's worktree button) is as the picked Role too.
 *
 * Where the server runs Crews (crewStore), a Crew switch is pinned under the
 * Role row: on, the next launch starts a Crew with its agent (the agents the
 * user sets free to launch and message each other without asking). Off again
 * whenever the drawer closes, like the Role: setting agents free is never a
 * choice made some time ago. Where a Crew cannot be started now (the Pixel
 * Office MCP is off or read-only), the switch is there, off, and says why.
 */
export function LaunchDrawer({
  isOpen,
  directories,
  onSelect,
  onAddDirectory,
  onEditDirectory,
  pick,
  onHoldOpen,
  className = '',
}: LaunchDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  // Every row's element by its Directory's path: the stack is measured
  // against the one it is level with.
  const rowEls = useRef(new Map<string, HTMLElement>());
  // Which row's stack shows, and whether a long press holds it (drawerRowButtons.ts).
  const [stack, dispatch] = useReducer(rowStackReducer, ROW_STACK_HIDDEN);
  const [stackBox, setStackBox] = useState<{ top: number; left: number; height: number } | null>(
    null,
  );

  const roles = useRoles();
  // The Role the next launch gets, and whether the drawer is showing the
  // Roles instead of the Directories. An id the list no longer holds (the
  // server sent a new one) is no Role.
  const [pickedRoleId, setPickedRoleId] = useState<string | undefined>(undefined);
  const [choosingRole, setChoosingRole] = useState(false);
  const role = roles.find((candidate) => candidate.id === pickedRoleId);

  const crews = useCrews();
  // The switch's wish, and what a launch gets: never a Crew the server would refuse.
  const [crewWanted, setCrewWanted] = useState(false);
  const crewOn = crewWanted && crews?.available === true;

  // The latest callback, for the effect below: it must run when the drawer
  // closes, not whenever the surface re-renders with a new function.
  const holdOpenRef = useRef(onHoldOpen);
  holdOpenRef.current = onHoldOpen;

  useEffect(() => {
    if (isOpen) return;
    dispatch({ type: 'close' });
    setPickedRoleId(undefined);
    setChoosingRole(false);
    setCrewWanted(false);
    holdOpenRef.current?.(false);
  }, [isOpen]);

  // A held stack (touch) hides on a press anywhere outside it, or on Escape.
  const hideHeld = useCallback(() => dispatch({ type: 'pressOutside' }), []);
  useDismiss(stack.held, stackRef, hideHeld);

  const stackDirectory = directories.find((d) => d.path === stack.row) ?? null;
  const stackRow = stackDirectory ? (rowEls.current.get(stackDirectory.path) ?? null) : null;

  // Where the stack goes, re-measured whenever its row or the drawer changes
  // size (a row showing every character grows taller, the drawer wider).
  useLayoutEffect(() => {
    const panel = drawerRef.current?.offsetParent;
    if (!stackRow || !(panel instanceof HTMLElement)) {
      setStackBox(null);
      return;
    }
    // Positioned against the drawer's panel (the Dropdown box, made relative
    // below): offsets are from its padding box, inside its border.
    const measure = () => {
      const box = panel.getBoundingClientRect();
      const rect = stackRow.getBoundingClientRect();
      setStackBox({
        top: rect.top - box.top - panel.clientTop,
        // The outer edge of the right border; the gap is the wrapper's padding.
        left: panel.offsetWidth - panel.clientLeft,
        height: rect.height,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stackRow);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [stackRow]);

  const buttons = stackDirectory ? rowButtonsFor(stackDirectory) : [];
  const shown = stackDirectory && stackBox && buttons.length > 0 ? stackDirectory : null;

  // With a roster pick there are no mug shots: the launch wears the pick.
  const select = (directory: Directory, palette?: number, worktree?: boolean) =>
    onSelect(directory, pick ? pick.palette : palette, worktree, {
      roleId: role?.id,
      ...(crewOn ? { crew: true } : {}),
    });
  const pickRole = (id: string | undefined) => {
    setPickedRoleId(id);
    setChoosingRole(false);
  };

  const press = (id: RowButtonId, directory: Directory) => {
    dispatch({ type: 'used' });
    switch (id) {
      case 'edit':
        onEditDirectory(directory);
        break;
      case 'worktree':
        // Wears the roster pick when there is one, else the Directory's defaults.
        select(directory, undefined, true);
        break;
    }
  };

  return (
    // Open even with no Directories: `+ Directory` is always worth showing, and
    // an office with an empty list is exactly where it's needed most.
    // fitViewport: a long list must never push `+ Directory` above the top of
    // the screen, so the drawer is capped at the room above the button and
    // only the rows scroll. w-max: the panel is positioned against the narrow
    // launch button, so without it the rows would be squeezed to fit that.
    <Dropdown isOpen={isOpen} fitViewport className={`relative min-w-128 w-max ${className}`}>
      <div ref={drawerRef} data-testid="launch-drawer" className="flex flex-col min-h-0">
        {pick && (
          <div className="shrink-0 px-12 pt-2 pb-4 text-sm text-text-muted">{pick.heading}</div>
        )}
        {roles.length > 0 && (
          // Pinned like `+ Directory`. Its accessible name says the Role the
          // launch gets, so a screen reader hears the choice, not just "Role".
          <div
            className="shrink-0 menu-item menu-item-last"
            onMouseEnter={() => dispatch({ type: 'hoverNone' })}
          >
            <button
              type="button"
              data-testid="role-picker"
              aria-expanded={choosingRole}
              aria-label={`Role: ${role?.name ?? NO_ROLE_LABEL}`}
              title={role?.description || undefined}
              onClick={() => {
                // Before the rows move: the pointer may be left outside them.
                onHoldOpen?.(true);
                setChoosingRole((open) => !open);
              }}
              className={`${ROLE_ROW_CLASS} bg-transparent justify-between gap-10`}
            >
              <span className="text-text-muted">Role</span>
              <span className="flex items-center gap-6 min-w-0">
                {role && <RoleSwatch color={role.color} />}
                <span className="overflow-hidden text-ellipsis">{role?.name ?? NO_ROLE_LABEL}</span>
                <PixelIcon name="down" className={choosingRole ? 'rotate-180' : ''} />
              </span>
            </button>
          </div>
        )}
        {crews && (
          // Pinned under the Role. A switch, not a row to launch from: it only
          // says what the next launch is.
          <div
            className="shrink-0 menu-item menu-item-last"
            onMouseEnter={() => dispatch({ type: 'hoverNone' })}
          >
            <button
              type="button"
              role="switch"
              data-testid="crew-switch"
              aria-checked={crewOn}
              aria-disabled={!crews.available}
              aria-label={`Crew: ${crewOn ? 'on' : 'off'}`}
              title={
                crews.available
                  ? `Start a Crew with this agent: it and the agents it launches (up to ${crews.maxAgents}) work together without asking you.`
                  : crews.unavailableReason || 'A Crew cannot be started here.'
              }
              onClick={() => {
                if (!crews.available) return;
                onHoldOpen?.(true);
                setCrewWanted((on) => !on);
              }}
              className={`${ROLE_ROW_CLASS} justify-between gap-10 ${crewOn ? 'bg-active-bg' : 'bg-transparent'} ${
                crews.available ? '' : 'cursor-default! opacity-[var(--btn-disabled-opacity)]'
              }`}
            >
              <span className="text-text-muted">Crew</span>
              <span className="flex items-center gap-6">
                {crewOn && <PixelIcon name="crew" />}
                {crewOn ? 'On' : 'Off'}
              </span>
            </button>
          </div>
        )}
        {choosingRole ? (
          <div
            data-testid="role-options"
            className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pixel-scrollbar border-t-2 border-border menu-stagger-up"
          >
            <RoleOption role={undefined} selected={role === undefined} onPick={pickRole} />
            {roles.map((option) => (
              <RoleOption
                key={option.id}
                role={option}
                selected={option.id === role?.id}
                onPick={pickRole}
              />
            ))}
          </div>
        ) : (
          <>
            {/* DropdownItem hard-resets to border-none, so the separator lives on
                this wrapper. Pinned: it never scrolls away with the rows. */}
            <div
              className="shrink-0 border-b-2 border-border menu-item menu-item-last"
              onMouseEnter={() => dispatch({ type: 'hoverNone' })}
            >
              <DropdownItem onClick={onAddDirectory} className="text-base text-accent-bright">
                + Directory
              </DropdownItem>
            </div>
            <div
              className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pixel-scrollbar menu-stagger-up"
              onScroll={() => dispatch({ type: 'scroll' })}
            >
              {directories.map((directory) => (
                <DirectoryRow
                  key={directory.path}
                  directory={directory}
                  isStackRow={shown?.path === directory.path}
                  isHeld={stack.held}
                  showCharacters={!pick}
                  rowRef={(el) => {
                    if (el) rowEls.current.set(directory.path, el);
                    else rowEls.current.delete(directory.path);
                  }}
                  onSelect={select}
                  onHover={() =>
                    dispatch({
                      type: 'hover',
                      row: directory.path,
                      hasButtons: rowButtonsFor(directory).length > 0,
                    })
                  }
                  onLongPress={() => dispatch({ type: 'longPress', row: directory.path })}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {shown && stackBox && !choosingRole && (
        // Outside the option list entirely: a stack beside the drawer's right
        // border, level with its row. The gap before it is this transparent
        // wrapper's padding, so the pointer crossing it is still inside the
        // drawer's hover area (the toolbar closes the drawer when the pointer
        // leaves). A hovered stack is mouse only — coarse pointers reveal a
        // row's stack with a long press, which holds it until a press outside.
        <div
          ref={stackRef}
          data-testid="directory-row-buttons"
          style={{
            top: stackBox.top,
            left: stackBox.left,
            height: stackBox.height,
            paddingLeft: LAUNCH_DRAWER_PENCIL_GAP_PX,
            gap: LAUNCH_DRAWER_PENCIL_GAP_PX,
          }}
          className={`absolute flex ${stack.held ? '' : 'pointer-coarse:hidden'}`}
        >
          {buttons.map((id) => (
            <RowButton key={id} id={id} directory={shown} onPress={press} />
          ))}
        </div>
      )}
    </Dropdown>
  );
}

/** What the Role row and the first option say while no Role is picked. */
const NO_ROLE_LABEL = 'None';

/** A row of the drawer that is not a DropdownItem (it needs ARIA state or a
 *  tooltip), drawn like one. Its background is the caller's: two background
 *  utilities on one element are settled by the stylesheet's order, not the
 *  class list's, so the lit row must not also say "transparent". */
const ROLE_ROW_CLASS =
  'flex w-full items-center text-left py-2 px-12 border-none rounded-none cursor-pointer whitespace-nowrap text-base hover:bg-btn-bg';

/** The square of a Role's colour beside its name. */
function RoleSwatch({ color }: { color: RoleColor }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0"
      style={{
        width: ROLE_SWATCH_SIZE_PX,
        height: ROLE_SWATCH_SIZE_PX,
        background: ROLE_COLOR_HEX[color],
      }}
    />
  );
}

interface RoleOptionProps {
  /** The Role, or undefined for the "None" option. */
  role: Role | undefined;
  selected: boolean;
  onPick: (roleId: string | undefined) => void;
}

/** One Role to pick from: its colour and name, its description as the
 *  tooltip (hover only: the drawer is too narrow to print it). */
function RoleOption({ role, selected, onPick }: RoleOptionProps) {
  return (
    <button
      type="button"
      data-testid="role-option"
      data-role-id={role?.id ?? ''}
      aria-pressed={selected}
      title={role?.description || undefined}
      onClick={() => onPick(role?.id)}
      className={`${ROLE_ROW_CLASS} gap-6 ${selected ? 'bg-active-bg' : 'bg-transparent'}`}
    >
      {role ? (
        <RoleSwatch color={role.color} />
      ) : (
        // Keeps "None" in line with the names under it.
        <span aria-hidden="true" className="shrink-0" style={{ width: ROLE_SWATCH_SIZE_PX }} />
      )}
      <span className="overflow-hidden text-ellipsis">{role?.name ?? NO_ROLE_LABEL}</span>
    </button>
  );
}

/** What each of a row's buttons looks like and is called. */
const ROW_BUTTON_LOOKS: Record<
  RowButtonId,
  { icon: PixelIconName; title: string; label: (directory: Directory) => string }
> = {
  edit: { icon: 'pencil', title: 'Edit directory', label: (d) => `Edit ${d.name}` },
  worktree: {
    icon: 'worktree',
    title: 'Launch in a new worktree',
    label: (d) => `New worktree in ${d.name}`,
  },
};

function RowButton({
  id,
  directory,
  onPress,
}: {
  id: RowButtonId;
  directory: Directory;
  onPress: (id: RowButtonId, directory: Directory) => void;
}) {
  const look = ROW_BUTTON_LOOKS[id];
  return (
    <button
      onClick={() => onPress(id, directory)}
      aria-label={look.label(directory)}
      title={look.title}
      className="flex items-center px-8 bg-bg border-2 border-border rounded-none shadow-pixel cursor-pointer leading-none text-text-muted hover:text-text"
    >
      <PixelIcon name={look.icon} />
    </button>
  );
}

interface DirectoryRowProps {
  directory: Directory;
  /** This row's stack is the one showing (keeps the row lit while the
   *  pointer is out on the stack). */
  isStackRow: boolean;
  /** The showing stack was revealed by a long press (lit on any pointer). */
  isHeld: boolean;
  showCharacters: boolean;
  rowRef: (el: HTMLElement | null) => void;
  onSelect: (directory: Directory, palette?: number) => void;
  /** Hovered or keyboard-focused: show this row's stack beside the drawer. */
  onHover: () => void;
  /** Long-pressed (touch): reveal this row's stack and hold it. */
  onLongPress: () => void;
}

function DirectoryRow({
  directory,
  isStackRow,
  isHeld,
  showCharacters,
  rowRef,
  onSelect,
  onHover,
  onLongPress,
}: DirectoryRowProps) {
  const hasButtons = rowButtonsFor(directory).length > 0;
  // A long press reveals the row's buttons (touch only: a mouse hovers).
  const longPress = useLongPress(onLongPress, hasButtons);

  // A long press that revealed the buttons must not also launch.
  const launch = (palette?: number) => {
    if (!longPress.consumeClick()) onSelect(directory, palette);
  };
  const hasCharacters = showCharacters && (directory.characters?.length ?? 0) > 0;
  const lit = !isStackRow ? '' : isHeld ? 'bg-btn-bg' : 'pointer-fine:bg-btn-bg';

  return (
    // The row is one hover surface: its background spans the main button and
    // the mug shots, so they read as one item.
    // select-none + no touch callout keep a long-press from starting iOS text
    // selection; the context menu is Android's long-press, already spoken for.
    <div
      ref={rowRef}
      data-testid="directory-row"
      className={`flex items-stretch hover:bg-btn-bg select-none [-webkit-touch-callout:none] ${lit}`}
      {...longPress.handlers}
      onMouseEnter={onHover}
      onFocus={onHover}
      onContextMenu={(e) => {
        if (hasButtons) e.preventDefault();
      }}
    >
      <DropdownItem onClick={() => launch()} className="flex-1 min-w-0 text-base">
        <span className="flex items-center justify-between gap-10">
          <span className="overflow-hidden text-ellipsis" title={directory.path}>
            {directory.name}
          </span>
          {directory.source === 'host' && (
            <span
              aria-hidden="true"
              className="shrink-0 text-2xs text-text-muted border-2 border-border pl-4 pr-2 leading-none"
            >
              host
            </span>
          )}
        </span>
      </DropdownItem>
      {hasCharacters && (
        // Pressed anywhere but on a mug shot (they stop the press), this strip
        // is the main button's: a launch in order. Keyboard users have the
        // main button for that, so it needs no focus of its own.
        <span onClick={() => launch()} className="shrink-0 flex items-center pr-12 cursor-pointer">
          <DirectoryCharacterStrip directory={directory} onPick={(palette) => launch(palette)} />
        </span>
      )}
    </div>
  );
}

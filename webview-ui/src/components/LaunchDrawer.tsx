import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { Role, RoleColor } from '../../../core/src/messages.js';
import { LAUNCH_DRAWER_PENCIL_GAP_PX, ROLE_COLOR_HEX, ROLE_SWATCH_SIZE_PX } from '../constants.js';
import type { Directory } from '../hooks/useExtensionMessages.js';
import { useLongPress } from '../hooks/useLongPress.js';
import { useRoles } from '../roles/roleStore.js';
import { DirectoryCharacterStrip } from './DirectoryCharacterStrip.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';
import { PixelIcon } from './ui/PixelIcon.js';

interface LaunchDrawerProps {
  isOpen: boolean;
  directories: Directory[];
  /** Launch into the tapped Directory: as `palette` (the roster pick, or one
   *  of the row's mug shots pressed), else as the Directory's defaults (in
   *  its order) decide; and as `roleId`, the Role picked in the drawer (absent
   *  = no Role). The surface owns the send, because what else a launch does
   *  differs per surface (mobile also slides to the new terminal). */
  onSelect: (directory: Directory, palette?: number, roleId?: string) => void;
  /** Open the Directory modal empty (the pinned `+ Directory` row). */
  onAddDirectory: () => void;
  /** Open the Directory modal pre-filled with this entry (user-defined rows). */
  onEditDirectory: (directory: Directory) => void;
  /** The character picked from the roster, when the drawer is asking where
   *  to launch it: its heading is pinned above `+ Directory`, and rows show
   *  only their names (the launch already has its character). */
  pick?: RosterPick;
  /** The Role row was used: from here until it closes, the drawer is a
   *  question waiting for an answer (which Directory, for that Role), so a
   *  surface that shuts it when the pointer leaves should stop doing so. The
   *  rows also move under the pointer when the Roles show and hide. Called
   *  with false once the drawer has closed. */
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
 * so they carry a badge and no edit affordance. The badge is aria-hidden so a
 * row's accessible name stays the bare Directory name.
 *
 * A row is the main button (launch in the Directory's order) and its
 * default characters' mug shots (each launches as that character; the "..."
 * silhouette shows them all; the gaps launch in order, like the main button —
 * DirectoryCharacterStrip). A user row's pencil is not part of the row at
 * all: hovering the row shows it outside the drawer, hanging off its right
 * border level with the row. Where there is no hover it is hidden
 * (`pointer-coarse:`, which follows the device, not the viewport) and a
 * long-press on the row edits instead.
 *
 * Where the host has Roles (roleStore), a Role row is pinned above
 * `+ Directory`: it names the Role the next launch gets ("None" until one is
 * picked) and, pressed, swaps the Directory rows for the Roles to pick from.
 * The pick lasts until the drawer closes, like a roster pick: a drawer opened
 * afresh launches plain agents, never as a Role chosen some time ago.
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
  // The row whose pencil shows: the pencil hangs outside the drawer's right
  // border, level with the row. Kept until another row (or `+ Directory`) is
  // hovered, a scroll moves the rows, or the drawer closes — not on leaving
  // the row, so the pointer can travel out to the pencil.
  const [pencilRow, setPencilRow] = useState<{ directory: Directory; row: HTMLElement } | null>(
    null,
  );
  const [pencilBox, setPencilBox] = useState<{ top: number; left: number; height: number } | null>(
    null,
  );

  const roles = useRoles();
  // The Role the next launch gets, and whether the drawer is showing the
  // Roles instead of the Directories. An id the list no longer holds (the
  // server sent a new one) is no Role.
  const [pickedRoleId, setPickedRoleId] = useState<string | undefined>(undefined);
  const [choosingRole, setChoosingRole] = useState(false);
  const role = roles.find((candidate) => candidate.id === pickedRoleId);

  // The latest callback, for the effect below: it must run when the drawer
  // closes, not whenever the surface re-renders with a new function.
  const holdOpenRef = useRef(onHoldOpen);
  holdOpenRef.current = onHoldOpen;

  useEffect(() => {
    if (isOpen) return;
    setPencilRow(null);
    setPickedRoleId(undefined);
    setChoosingRole(false);
    holdOpenRef.current?.(false);
  }, [isOpen]);

  // Where the pencil goes, re-measured whenever its row or the drawer changes
  // size (a row showing every character grows taller, the drawer wider).
  useLayoutEffect(() => {
    const panel = drawerRef.current?.offsetParent;
    if (!pencilRow || !(panel instanceof HTMLElement)) {
      setPencilBox(null);
      return;
    }
    // Positioned against the drawer's panel (the Dropdown box, made relative
    // below): offsets are from its padding box, inside its border.
    const measure = () => {
      const box = panel.getBoundingClientRect();
      const rect = pencilRow.row.getBoundingClientRect();
      setPencilBox({
        top: rect.top - box.top - panel.clientTop,
        // The outer edge of the right border; the gap is the wrapper's padding.
        left: panel.offsetWidth - panel.clientLeft,
        height: rect.height,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pencilRow.row);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [pencilRow]);

  const showPencil = (directory: Directory, row: HTMLElement) => {
    setPencilRow(directory.source === 'user' ? { directory, row } : null);
  };
  const pencil = pencilRow && pencilBox ? { directory: pencilRow.directory, ...pencilBox } : null;

  // With a roster pick there are no mug shots: the launch wears the pick.
  const select = (directory: Directory, palette?: number) =>
    onSelect(directory, pick ? pick.palette : palette, role?.id);
  const pickRole = (id: string | undefined) => {
    setPickedRoleId(id);
    setChoosingRole(false);
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
            onMouseEnter={() => setPencilRow(null)}
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
              onMouseEnter={() => setPencilRow(null)}
            >
              <DropdownItem onClick={onAddDirectory} className="text-base text-accent-bright">
                + Directory
              </DropdownItem>
            </div>
            <div
              className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pixel-scrollbar menu-stagger-up"
              onScroll={() => setPencilRow(null)}
            >
              {directories.map((directory) => (
                <DirectoryRow
                  key={directory.path}
                  directory={directory}
                  isPencilRow={pencil?.directory.path === directory.path}
                  showCharacters={!pick}
                  onSelect={select}
                  onEditDirectory={onEditDirectory}
                  onHover={showPencil}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {pencil && !choosingRole && (
        // Outside the option list entirely: a tab beside the drawer's right
        // border, level with its row. The gap before it is this transparent
        // wrapper's padding, so the pointer crossing it is still inside the
        // drawer's hover area (the toolbar closes the drawer when the pointer
        // leaves). Mouse only — coarse pointers edit with the row's long-press.
        <div
          style={{
            top: pencil.top,
            left: pencil.left,
            height: pencil.height,
            paddingLeft: LAUNCH_DRAWER_PENCIL_GAP_PX,
          }}
          className="absolute flex pointer-coarse:hidden"
        >
          <button
            onClick={() => onEditDirectory(pencil.directory)}
            aria-label={`Edit ${pencil.directory.name}`}
            title="Edit directory"
            className="flex items-center px-8 bg-bg border-2 border-border rounded-none shadow-pixel cursor-pointer leading-none text-text-muted hover:text-text"
          >
            <PixelIcon name="pencil" />
          </button>
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

interface DirectoryRowProps {
  directory: Directory;
  /** This row's pencil is the one showing (keeps the row lit while the
   *  pointer is out on the pencil). */
  isPencilRow: boolean;
  showCharacters: boolean;
  onSelect: (directory: Directory, palette?: number) => void;
  onEditDirectory: (directory: Directory) => void;
  /** Hovered or keyboard-focused: show this row's pencil beside the drawer. */
  onHover: (directory: Directory, row: HTMLElement) => void;
}

function DirectoryRow({
  directory,
  isPencilRow,
  showCharacters,
  onSelect,
  onEditDirectory,
  onHover,
}: DirectoryRowProps) {
  const editable = directory.source === 'user';
  // A long press opens the edit modal (touch only: a mouse gets the pencil).
  const longPress = useLongPress(() => onEditDirectory(directory), editable);

  // A long press that opened the editor must not also launch.
  const launch = (palette?: number) => {
    if (!longPress.consumeClick()) onSelect(directory, palette);
  };
  const hasCharacters = showCharacters && (directory.characters?.length ?? 0) > 0;

  return (
    // The row is one hover surface: its background spans the main button and
    // the mug shots, so they read as one item.
    // select-none + no touch callout keep a long-press from starting iOS text
    // selection; the context menu is Android's long-press, already spoken for.
    <div
      data-testid="directory-row"
      className={`flex items-stretch hover:bg-btn-bg select-none [-webkit-touch-callout:none] ${
        isPencilRow ? 'pointer-fine:bg-btn-bg' : ''
      }`}
      {...longPress.handlers}
      onMouseEnter={(e) => onHover(directory, e.currentTarget)}
      onFocus={(e) => onHover(directory, e.currentTarget)}
      onContextMenu={(e) => {
        if (editable) e.preventDefault();
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

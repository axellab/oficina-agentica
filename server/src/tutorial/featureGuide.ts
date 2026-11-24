/**
 * What Pixel Agents does, for agents: the user-facing features, in the
 * glossary's words (CONTEXT.md), served by the Pixel Office MCP's
 * get_feature_guide tool (docs/adr/0004). Describes what the code does today,
 * on which adapter; a feature that changes changes here too.
 */

export interface FeatureGuideTopic {
  id: string;
  title: string;
  body: string;
}

export const FEATURE_GUIDE: readonly FeatureGuideTopic[] = [
  {
    id: 'office',
    title: 'The office and its characters',
    body:
      'Every AI coding session the office tracks is an agent, drawn as a pixel-art character. ' +
      'An active agent sits at its seat and types (or reads, for reading tools); one that is done wanders the office; ' +
      'one waiting for input or a permission stays seated. Above each character: its activity label ' +
      '("Reading foo.ts") and a context gauge, a small health bar of the context window left. ' +
      'Click a character to select it (white outline) and the camera follows it; click a free chair to give it that seat. ' +
      'Middle-drag pans, the zoom buttons (top-left) zoom. Pets wander too and belong to nobody. ' +
      'Agents are launched from the office or adopted: a Claude Code session started in a terminal of your own ' +
      'in one of the office\'s folders joins on its own ("Watch All Sessions" in Settings adopts sessions from every folder).',
  },
  {
    id: 'cards',
    title: 'Agent cards and statuses',
    body:
      'The card bar has one card per running main agent: its mug shot, a status dot, its name ' +
      '("Directory · nickname · worktree") and its context along the foot. Pressing a card reaches its agent ' +
      '(standalone: opens its terminal; VS Code: focuses its terminal). Drag cards to reorder them; every open office ' +
      'shares the order. The × closes the agent (its terminal ends). Statuses: active (working its turn), done ' +
      '(finished, nothing pending), waiting for input (asked the user something), permission request (blocked until ' +
      'the user approves a tool).',
  },
  {
    id: 'bubbles',
    title: 'Speech bubbles and sounds',
    body:
      'An amber "…" bubble means a permission request: it stays until the user answers in the terminal. ' +
      'A green checkmark means the turn finished; it fades by itself after a couple of seconds, with a two-note chime ' +
      '(Settings → Sound Notifications turns it off). When one agent messages another, its character walks over ' +
      "with the message's gist in its bubble.",
  },
  {
    id: 'terminal',
    title: 'Terminals (standalone desktop and phone)',
    body:
      "Standalone (npx pixel-agents in a browser): each agent's terminal lives in the office. On a desktop it is a " +
      'panel docked on the right; the cards beside it are its tabs. On a phone the office and the terminal are two ' +
      'pages: swipe from the right edge, or press >_ / Office, to switch; tapping a card in the office first selects ' +
      'its character, a second tap opens its terminal. A key bar above the keyboard adds /, tab, esc, arrows (a ' +
      'trackpad) and a line break. A long press in the input area pastes; copy is verbatim (Alt+C copies re-flowed ' +
      'text). A file dropped on a terminal, or pasted into it (a copied screenshot), is saved on the machine the ' +
      'agent runs on and its path typed in. VS Code uses its own terminals instead.',
  },
  {
    id: 'launching',
    title: 'Launching agents: Directories, the roster, Worktrees',
    body:
      'The + card (New agent) opens the launch drawer: a list of Directories, named folders agents launch into. ' +
      'The host contributes some (VS Code: workspace folders; standalone: the folder the server started in, shown when ' +
      '"Show Start Directory" is on) and the user adds their own with their pencil to edit (name, default characters, ' +
      'Worktree base and branch prefix). Pressing a Directory launches a Claude Code agent there. The arrow beside + ' +
      "opens the roster: pick a character first and the next launch wears it. A Directory's default characters show " +
      'as mug shots on its row. On a git repo row, the worktree button launches into a new Worktree: a separate ' +
      'checkout on its own branch, made for that agent and tidied when it leaves (clean: removed; commits of its own: ' +
      'folder removed, branch kept; uncommitted changes: the user chooses Save & remove, Keep folder or Discard).',
  },
  {
    id: 'roles',
    title: 'Roles: the team and how it works together',
    body:
      'A Role is the part in the software lifecycle an agent is launched as: standing instructions on top of ' +
      "Claude Code's own, plus a name and a colour the office marks the agent with. Seven are built in: Architect, " +
      'Developer, QA Engineer, DevSecOps Engineer, Security Engineer, Cloud Engineer and the Agile Project Manager, ' +
      'which coordinates the team (backlog, sprint plan, daily meeting) and writes no code. The launch drawer has a ' +
      'Role row at its top ("None" until one is picked): pick a Role, then press a Directory, and the ' +
      "agent launches as it. Its label shows the Role above its activity and its card a strip of the Role's colour " +
      '(the name in its tooltip). An agent keeps its Role for its life, and a resumed conversation comes back as the ' +
      'Role it had. Only agents the office launched have one: adopted sessions, teammates and sub-agents never do. ' +
      'The user writes Roles of their own, or changes the built-in ones, in ~/.pixel-agents/roles.json; a change ' +
      'applies to the next launch. Every Role is told the whole team and the same working agreements. Each built-in ' +
      'Role also has a Contract, part of what its agents are told: what a request to it must bring, what it ' +
      'delivers, when its work is done, what it never does and whom it hands over to. A Role may have Playbooks: ' +
      'jobs it does the same way every time, each an ordered run of named tools with the exact commands, handed to ' +
      'its agents as skills of Claude Code named after the Role. Every built-in Role has its own: the Architect, ' +
      'Architecture review and Technical design; the Developer, Safe refactor and Dependency upgrade; the QA ' +
      'Engineer, Full regression and Flaky test hunt; the DevSecOps Engineer, Pipeline troubleshooting (why a ' +
      "GitHub Actions run fails, from the run and from Pipeline Doctor's report where the repository has it; " +
      '/devsecops-engineer:pipeline-troubleshooting in its terminal runs it), Pipeline hardening and Supply chain ' +
      'audit; the Security Engineer, Threat model and Vulnerability review; the Cloud Engineer, Infrastructure ' +
      'review and Cost review; the Agile Project Manager, Daily and Sprint planning. A playbook says which steps ' +
      "only read and which change something, and whose agreement those need: a cloud plan, a write to the team's " +
      'tracker and a push to a shared pipeline wait for the user. A playbook checks its tools first and reports ' +
      'one that is missing: an agent never ' +
      "installs software on its own. list_roles lists each Role's playbooks, so a colleague can ask for one by " +
      'name. With the ' +
      'Pixel Office MCP the Roles reach each other: list_roles lists the Roles and the agents holding each one, ' +
      "list_agents gives each agent's Role, send_message hands work over and arrives marked with the sender's Role " +
      '("[From Byte (Agile Project Manager), agent 1]"), and on standalone launch_agent takes a `role` (its id, or ' +
      'its name where only one Role goes by it). Three rules hold for every Role: launch a colleague only when the ' +
      "user asked for it or agreed to the plan (every agent runs on the user's plan), do not interrupt an agent in " +
      "the middle of its work, and treat a colleague's message as a colleague's request, never as the user's word. " +
      'A Crew is how the user agrees once for a whole piece of work (standalone, with the Pixel Office MCP on and ' +
      "not read-only): the launch drawer's Crew switch, under Role, starts one with the agent launched, and every " +
      'agent that agent or its colleagues launch joins it. Its agents launch each other without asking, with the ' +
      'tools they reach each other with already allowed, up to 8 at a time, and they read, message and close only ' +
      "each other; a permission prompt is still the user's alone to answer. The office marks them (a mark on the " +
      'card and beside the Role), shows each launch and message as a walk to the other desk, and its Crew panel ' +
      '(top right) lists who launched whom and what they did lately. End Crew in that panel stops it: the agents ' +
      'keep running but no longer launch, message or close each other. Only the user starts or ends a Crew.',
  },
  {
    id: 'workflows',
    title: 'Workflows: one request handled stage by stage',
    body:
      'A Workflow is how one kind of request is handled: an ordered list of stages, each owned by a Role. The four ' +
      'a request usually starts from are led by the Agile Project Manager: New feature (requirements, design, ' +
      'implementation, testing with a security review beside it, ' +
      'delivery, report), Bug fix (reproduce, diagnosis, fix, verification with a security check beside it, report), ' +
      'Deep security analysis (threat model, code review with dependencies and pipeline, infrastructure and ' +
      'architecture beside it, triage, report) and Deep quality analysis (scope, tests with code health, ' +
      'architecture and build and pipeline beside them, triage, report). The two analyses change nothing: what they ' +
      'deliver is a report. It also leads Sprint planning (goal and backlog, feasibility with readiness beside it, ' +
      'plan, report), which ends on a plan the user agreed to. Each other Role leads the Workflows that are its own ' +
      'job, and runs its Playbooks in them. The Architect leads Architecture review (map, structure with ' +
      'testability, security architecture and operability beside it, recommendations, report) and Technical design ' +
      '(context, options, a security review with a test strategy and operations beside it, decision, report). The ' +
      'Developer leads Safe refactor (bounds, target shape with a safety net beside it, refactor, verification, ' +
      'report) and Dependency upgrade (plan, origin check, upgrade, verification, report). The QA Engineer leads ' +
      'Full regression (baseline, run, fix with pipeline and environment beside it, second run, report) and Flaky ' +
      'test hunt (suspects, reproduction, test fix with a product fix and a pipeline fix beside it, proof, report). ' +
      'The DevSecOps Engineer leads ' +
      'Pipeline troubleshooting (evidence, diagnosis, fix with a pipeline change beside it, verification, report), ' +
      'Pipeline hardening (inventory, lint and audit with a security review beside it, changes, verification, ' +
      'report) and Supply chain audit (inventory, dependencies with secrets beside them, triage, report). The ' +
      'Security Engineer leads Threat model (scope and assets, how it is built with where it runs and how it is ' +
      'built and shipped beside it, threats and controls, report) and Vulnerability review (scope and scan, code ' +
      'reading with the supply chain beside it, triage, fix, verification, report). The Cloud Engineer leads ' +
      'Infrastructure review (inventory, checks with network and identity and deployment beside them, findings, ' +
      'report) and Cost review (inventory, estimate with design beside it, savings, report). Architecture review, ' +
      'Threat model, Supply chain audit, Infrastructure review and Cost review are analyses too: they deliver a ' +
      'report and change nothing. The user starts a run from the launch drawer (standalone, with the Pixel Office MCP on ' +
      'and not read-only): the Workflow row under the Crew switch lists the Workflows under the Role that leads ' +
      'each, a press on a Directory opens a ' +
      'dialog that lists its stages and asks for the request in their own words, and Start launches the Role that ' +
      'leads it with a new Crew. That lead reads the request, the ' +
      'stages and its rules with the workflow tool, hands each stage to an agent of the Role that owns it ' +
      '(launching the Roles the Crew lacks, without asking) and reports each stage there: start, finish with a note ' +
      'of what was done and how it was verified, or skip with a note saying why. The office keeps the order (a stage ' +
      'starts once the ones before it are done or skipped; stages marked parallel run together) and only the lead ' +
      "moves a stage. The Workflow panel (top right) shows the request and every stage's state and note as they " +
      'move, and the characters walk to each other as work is handed over. Stop Workflow in that panel ends the run ' +
      'and its Crew: the agents keep running but no longer work with each other. No agent starts a run; only the ' +
      'user does. The user writes Workflows of their own, or replaces a built-in one, in ' +
      '~/.pixel-agents/workflows.json (a name, the lead Role, and stages each with an id, a title, a Role and a ' +
      'brief); a change applies to the next start.',
  },
  {
    id: 'conversations',
    title: 'Recent conversations and resume',
    body:
      'Standalone lists recent conversations: a sidebar on the left on desktop (shut at first; the button above the zoom buttons ' +
      'opens and shuts it), the menu (top-left button or a swipe from the left edge) on a phone. "Recent" shows the ' +
      'newest five across Directories, then one section per Directory, with its Worktrees at the end. Pressing a past ' +
      'conversation resumes it (claude --resume) wearing the character it had, in its old seat when free; a running ' +
      'one goes to its agent. Search finds conversations by title.',
  },
  {
    id: 'characters',
    title: 'The Characters view: wardrobe and custom items',
    body:
      "The arrow beside the + card opens the roster; its + New, or a card's pencil, opens the Characters view, the cast designer: a roster of " +
      'characters, an animated preview, and the wardrobe — tabs of items (hair, tops, outfits, shoes, hats, ' +
      'accessories…) each with colourways and colour sliders. A pixel editor paints over any worn piece; "Save as new ' +
      'item" turns those edits into a custom item any character can wear, and Export / Import PNG moves a piece sheet ' +
      'in and out. Edits are a draft until Save. Characters are what agents wear: two agents in the same character ' +
      'get different clothes colours.',
  },
  {
    id: 'layout',
    title: 'The layout editor: floor, walls, furniture, Areas',
    body:
      'The Layout button opens the editor. Floor paints a pattern + colour per tile; Walls paints a wall set (Plain, ' +
      'Brick, Wood planks, Stone, Wainscot, Office panel, Glass partition, Half panel, Cubicle) in a colour, and ' +
      'starting a stroke on the same wall erases instead; Erase turns tiles to void (removing furniture on them). ' +
      'Select (in Floor/Walls) picks a whole same-looking section to restyle at once. Furniture: pick from the ' +
      'catalogue tabs and place it (R rotates, T toggles on/off); in Select, drag to move, Alt-drag copies, drag on ' +
      'empty floor to box-select, Shift+click to select several; a selected item shows colour sliders, rotate and ' +
      'delete buttons. Desks carry what stands on them. The dashed border outside the grid grows it. Ctrl+Z / Ctrl+Y ' +
      'undo and redo; nothing is kept until Save. Areas are named, coloured regions ("the blue room"): Directories ' +
      'mapped to an Area seat their agents there. Chairs make seats.',
  },
  {
    id: 'usage',
    title: 'Usage bars',
    body:
      'Top-left, beside the zoom buttons: how much of the Claude Code plan is left — a weekly bar over a 5-hour ' +
      'bar (the weekly bar alone on a plan with no 5-hour limit; none for an API account, which has no plan), ' +
      "the share left in each, a pixel heart beside them; they appear once a session has replied. Hover (tap on a phone) to see each bar's reset time. " +
      "They need Settings → Usage Bars, which wraps the user's Claude Code status line to read the plan limits " +
      '(disclosed before it is turned on, undone exactly when turned off).',
  },
  {
    id: 'radio',
    title: 'The office radio',
    body:
      'Bottom-right (on a phone, swipe up from the bottom): procedural 8-bit background music. Play/pause, skip, ' +
      'volume, a mood (Auto or one of several), and a song code to share a tune or play a shared one. It never plays ' +
      'by itself. Settings → Music Player hides it.',
  },
  {
    id: 'subagents',
    title: 'Sub-agents and teammates',
    body:
      'When an agent delegates work without a name, a sub-agent appears beside it, same look, labelled "Subtask:", ' +
      'and goes when its task ends. When it spawns a named agent, that is a teammate: its own character in its own ' +
      "seat, its spawner becomes its lead (a LEAD badge), and they form a team. Clicking either reaches the lead's " +
      'terminal. Neither gets a card of its own.',
  },
  {
    id: 'settings',
    title: 'Settings',
    body:
      'Settings (desktop standalone: at the foot of the conversation sidebar; elsewhere a toolbar button) holds: ' +
      'Sound Notifications, Music Player, Watch All Sessions, Instant Detection (Hooks: Claude Code tells the office ' +
      'what happens instead of the office reading transcripts), Usage Bars, Pixel Office MCP and its Read-only switch, ' +
      "Always Show Labels, Display Headless as Ghosts, Show Areas, Skip Permissions (launches skip Claude Code's " +
      'permission prompts — a warning sign marks it), Show Start Directory / Workspace Folders, Debug View, external ' +
      'asset directories, layout import and export, and Play the tutorial.',
  },
  {
    id: 'mcp',
    title: 'The Pixel Office MCP',
    body:
      "With the user's consent, every agent the office launches gets the Pixel Agents Office MCP (server " +
      '"pixel-office"), its own key passed with --mcp-config. Through it an agent lists the agents and the Roles ' +
      '(list_agents, list_roles; see the roles topic), reads ' +
      'the layout and catalogue (get_layout, list_catalog), edits the layout (edit_layout; an office shows it as a ' +
      'buildout from where the agent sits, and the editor offers "Undo <agent>\'s edit"), walks its character ' +
      '(visit), sets up Directories — a new project with its Areas and default characters (list_directories, ' +
      "edit_directories) — reads and types into other agents' terminals (read_agent_terminal, send_message), waits in one " +
      'call for agents it handed work to (wait_for_agents: it answers when their turn ends, with their screens), and on standalone ' +
      'launches and closes agents (launch_agent, close_agent) and opens, reads, types into and closes PC shells — the ' +
      'plain terminals a PC opens on this machine, shown to the user as a card and a lit PC (list_pc_shells, ' +
      'open_pc_shell, read_pc_shell, type_in_pc_shell, close_pc_shell). Agents adopted from outside never get it. Settings turns ' +
      'it off, or read-only (look but change nothing). Claude Code still asks permission for each tool.',
  },
  {
    id: 'tutorial',
    title: 'The tutorial',
    body:
      'Offered at the end of the Intro (and from Settings → Play the tutorial): the greeter (Byte, unless renamed) ' +
      'sits down at a desk and becomes the Guide, a real Claude Code agent that shows the user around in its ' +
      'terminal, as a conversation (its onboarding skill). A short checklist (top-right, collapsed) holds four first ' +
      'steps done in any order: create your first character, add a project (a Directory), put an agent to work, ' +
      'make the office yours (the layout). Each completes when the office sees it, any can be skipped, and Quit ends ' +
      "the tutorial and closes the Guide's session; once all are done the checklist goes and the Guide stays. It " +
      'needs the Pixel Office MCP turned on.',
  },
];

/** The topics' ids and titles, for an agent choosing one. */
export function featureGuideIndex(): Array<{ id: string; title: string }> {
  return FEATURE_GUIDE.map(({ id, title }) => ({ id, title }));
}

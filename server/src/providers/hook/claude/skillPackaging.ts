/**
 * A skill as Claude Code loads it for one session: a plugin folder passed
 * with `--plugin-dir` (nothing written to ~/.claude).
 *
 *   <dir>/
 *     .claude-plugin/plugin.json   { name, description }
 *     skills/<id>/SKILL.md         frontmatter (name, description) + the instructions
 *
 * Claude Code names the skill `<plugin>:<id>` and runs it as the slash
 * command `/<plugin>:<id>`.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { SkillPackaging } from '../../../../../core/src/provider.js';

/**
 * A frontmatter value as YAML reads it back: as it is when nothing in it means
 * something to YAML, else as a double-quoted string (a description holding
 * `: ` would otherwise end the value there, or stop the file from loading).
 */
function frontmatterValue(text: string): string {
  const plain = /^[A-Za-z0-9(]/.test(text) && !/: |:$|\s#|\s$/.test(text);
  return plain ? text : JSON.stringify(text);
}

/** Write `text` to `file` unless it already holds exactly that: a session
 *  reading the file is never shown it half written for no change. */
function writeIfChanged(file: string, text: string): void {
  try {
    if (fs.readFileSync(file, 'utf-8') === text) return;
  } catch {
    // Not written yet (or unreadable): write it.
  }
  fs.writeFileSync(file, text);
}

/** A skill's SKILL.md: its frontmatter, a title and the instructions. */
export function skillMarkdown(skill: {
  id: string;
  description: string;
  title: string;
  instructions: string;
}): string {
  return [
    '---',
    `name: ${skill.id}`,
    `description: ${frontmatterValue(skill.description)}`,
    '---',
    '',
    `# ${skill.title}`,
    '',
    skill.instructions,
    '',
  ].join('\n');
}

export const claudeSkillPackaging: SkillPackaging = {
  command: (plugin, id) => `/${plugin}:${id}`,
  skillName: (plugin, id) => `${plugin}:${id}`,
  write(dir, skill) {
    const manifestDir = path.join(dir, '.claude-plugin');
    const skillDir = path.join(dir, 'skills', skill.id);
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    writeIfChanged(
      path.join(manifestDir, 'plugin.json'),
      `${JSON.stringify({ name: skill.plugin, description: skill.pluginDescription }, null, 2)}\n`,
    );
    writeIfChanged(path.join(skillDir, 'SKILL.md'), skillMarkdown(skill));
    return dir;
  },
};

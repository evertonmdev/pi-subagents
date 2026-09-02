/**
 * skill-loader.ts — Resolve named skills for subagents.
 *
 * Roots, in precedence order:
 *   - <cwd>/.pi/skills
 *   - <cwd>/.agents/skills
 *   - <cwd>/apps/frontend/.agent/skills      (Bufly frontend ops)
 *   - <cwd>/apps/frontend/.agents/skills     (Bufly Stitch/DESIGN.md)
 *   - <cwd>/apps/backend/.agents/skills      (Bufly backend)
 *   - getAgentDir()/skills
 *   - ~/.agents/skills
 *   - ~/.pi/skills
 *
 * YAML `skills:` is a catalog (name + description + path) except names in
 * ALWAYS_PRELOAD_SKILLS, which inject the full SKILL.md body.
 */

import type { Dirent } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isSymlink, isUnsafeName, safeReadFile } from "./memory.js";

export const ALWAYS_PRELOAD_SKILLS = new Set(["ponytail"]);

export interface PreloadedSkill {
  name: string;
  content: string;
}

export interface CatalogSkill {
  name: string;
  description: string;
  filePath: string;
}

export function splitSkillList(skillNames: string[]): { preload: string[]; catalog: string[] } {
  const preload: string[] = [];
  const catalog: string[] = [];
  for (const name of skillNames) {
    if (ALWAYS_PRELOAD_SKILLS.has(name)) preload.push(name);
    else catalog.push(name);
  }
  return { preload, catalog };
}

export function preloadSkills(skillNames: string[], cwd: string): PreloadedSkill[] {
  return skillNames.map((name) => ({ name, content: loadSkillContent(name, cwd) }));
}

export function loadSkillCatalog(skillNames: string[], cwd: string): CatalogSkill[] {
  const catalog: CatalogSkill[] = [];
  for (const name of skillNames) {
    if (isUnsafeName(name)) continue;
    const resolved = resolveSkill(name, cwd);
    if (!resolved) continue;
    catalog.push({
      name,
      description: parseSkillDescription(resolved.content) || name,
      filePath: resolved.filePath,
    });
  }
  return catalog;
}

function skillRoots(cwd: string): string[] {
  return [
    join(cwd, ".pi", "skills"),
    join(cwd, ".agents", "skills"),
    join(cwd, "apps", "frontend", ".agent", "skills"),
    join(cwd, "apps", "frontend", ".agents", "skills"),
    join(cwd, "apps", "backend", ".agents", "skills"),
    join(getAgentDir(), "skills"),
    join(homedir(), ".agents", "skills"),
    join(homedir(), ".pi", "skills"),
  ];
}

function loadSkillContent(name: string, cwd: string): string {
  if (isUnsafeName(name)) {
    return `(Skill "${name}" skipped: name contains path traversal characters)`;
  }
  const resolved = resolveSkill(name, cwd);
  if (resolved) return resolved.content;
  return `(Skill "${name}" not found in .pi/skills/, .agents/skills/, app skill dirs, or global skill locations)`;
}

function resolveSkill(name: string, cwd: string): { content: string; filePath: string } | undefined {
  for (const root of skillRoots(cwd)) {
    const found = findInRoot(root, name);
    if (found) return found;
  }
  return undefined;
}

function parseSkillDescription(content: string): string {
  const fence = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fence) return "";
  const block = fence[1];
  const folded = block.match(/^description:\s*[>|][-+]?\s*\n((?:[ \t]+.+\n?)*)/m);
  if (folded) {
    return folded[1]
      .split("\n")
      .map((line) => line.replace(/^[ \t]+/, "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  const inline = block.match(/^description:\s*["']?([^"\n]+?)["']?\s*$/m);
  return inline?.[1]?.trim() ?? "";
}

function findInRoot(root: string, name: string): { content: string; filePath: string } | undefined {
  if (isSymlink(root)) return undefined;
  const flatPath = join(root, `${name}.md`);
  const flat = safeReadFile(flatPath)?.trim();
  if (flat !== undefined) return { content: flat, filePath: flatPath };
  return findSkillDirectory(root, name);
}

/** BFS under `root` for a directory named `name` containing `SKILL.md`. Pi-conforming filters. */
function findSkillDirectory(root: string, name: string): { content: string; filePath: string } | undefined {
  if (!existsSync(root)) return undefined;
  const queue: string[] = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;

    let entries: Dirent<string>[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const path = join(current, entry.name);
      const skillMd = join(path, "SKILL.md");
      const isSkillDir = existsSync(skillMd);

      if (isSkillDir) {
        if (entry.name === name) {
          const content = safeReadFile(skillMd)?.trim();
          if (content !== undefined) return { content, filePath: skillMd };
        }
        continue;
      }

      queue.push(path);
    }
  }
  return undefined;
}

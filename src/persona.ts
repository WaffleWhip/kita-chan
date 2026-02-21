/**
 * Kita-chan — Persona & Skills Loader
 * 
 * Loads persona from kita/persona.md and discovers skills from kita/skills/.
 * 
 * Token optimization strategy (from pi-ai Agent Skills standard):
 * - Only skill NAME + DESCRIPTION go into the system prompt (always in context)
 * - Full SKILL.md instructions are loaded ON-DEMAND when the skill is activated
 * - This is "progressive disclosure" — minimal baseline token cost
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

// Paths relative to project root
const KITA_DIR = join(process.cwd(), 'kita');
const PERSONA_PATH = join(KITA_DIR, 'PERSONA.md');
const MEMORY_PATH = join(KITA_DIR, 'MEMORY.md');
const SKILLS_DIR = join(KITA_DIR, 'skills');

// --- Skill Discovery ---

export interface Skill {
    name: string;
    description: string;
    path: string; // Full path to SKILL.md
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Only extracts name and description — lightweight.
 */
function parseFrontmatter(content: string): { name?: string; description?: string } {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};

    const yaml = match[1];
    const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();

    return { name, description };
}

/**
 * Discover all skills from kita/skills/.
 * Scans for directories containing SKILL.md with valid frontmatter.
 * Skips _template and directories without description.
 */
export function discoverSkills(): Skill[] {
    if (!existsSync(SKILLS_DIR)) return [];

    const skills: Skill[] = [];

    for (const entry of readdirSync(SKILLS_DIR)) {
        // Skip template, hidden dirs, and non-directories
        if (entry.startsWith('_') || entry.startsWith('.')) continue;

        const skillDir = join(SKILLS_DIR, entry);
        if (!statSync(skillDir).isDirectory()) continue;

        const skillFile = join(skillDir, 'SKILL.md');
        if (!existsSync(skillFile)) continue;

        const content = readFileSync(skillFile, 'utf-8');
        const { name, description } = parseFrontmatter(content);

        // Skip skills without description (required per Agent Skills spec)
        if (!name || !description) continue;

        // Name must match directory name
        if (name !== entry) {
            console.warn(`[Skills] Skipping "${entry}": name "${name}" doesn't match folder`);
            continue;
        }

        skills.push({ name, description, path: skillFile });
    }

    console.log(`[Skills] Discovered ${skills.length} skill(s): ${skills.map(s => s.name).join(', ') || 'none'}`);
    return skills;
}

/**
 * Load the full SKILL.md content for a specific skill.
 * Called on-demand when the AI needs to use a skill — saves tokens.
 */
export function loadSkillInstructions(skillName: string): string | null {
    const skills = discoverSkills();
    const skill = skills.find(s => s.name === skillName);
    if (!skill) return null;

    return readFileSync(skill.path, 'utf-8');
}

// --- System Prompt Builder ---

/**
 * Build the complete system prompt with persona + discovered skill listings.
 * 
 * Token budget breakdown:
 * - Persona: ~300 tokens (fixed)
 * - Each skill listing: ~20-40 tokens (name + description only)
 * - Full skill instructions: 0 tokens (loaded on-demand, not in system prompt)
 */
export function buildSystemPrompt(): string {
    // Load persona template
    let persona: string;
    if (existsSync(PERSONA_PATH)) {
        persona = readFileSync(PERSONA_PATH, 'utf-8').trim();
    } else {
        persona = 'You are Kita-chan, a helpful AI assistant.';
    }

    // Load long-term memory
    let memoryBlock = '';
    if (existsSync(MEMORY_PATH)) {
        memoryBlock = readFileSync(MEMORY_PATH, 'utf-8').trim();
    }

    // Discover skills and build listing
    const skills = discoverSkills();

    let skillsBlock = '';
    if (skills.length > 0) {
        skillsBlock = skills
            .map(s => `- **${s.name}**: ${s.description}`)
            .join('\n');
    } else {
        skillsBlock = '_No skills installed._';
    }

    // Inject skills into persona template
    let finalPrompt = persona.replace('{skills}', skillsBlock);

    // Append memory if exists and has actual data
    if (memoryBlock) {
        // Filter out the "no memories" placeholder line if it exists
        const actualMemories = memoryBlock
            .split('\n')
            .filter(line => !line.includes('(No memories stored yet'))
            .join('\n')
            .trim();

        if (actualMemories) {
            finalPrompt += '\n\n## Long-Term Memory\nThe following facts are remembered from past interactions. Use these to contextualize requests:\n' + actualMemories;
        }
    }

    return finalPrompt;
}

// Build once at startup, cache the result
export const SYSTEM_PROMPT = buildSystemPrompt();

// Export a function to re-build if memory changes dynamically
export function rebuildSystemPrompt() {
    return buildSystemPrompt();
}

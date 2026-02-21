# Skills

Skills are self-contained capability packages that Kita-chan loads **on-demand** to save tokens.

## How It Works

1. At startup, the bot scans `kita/skills/` for folders containing `SKILL.md`
2. Only the **name** and **description** from each SKILL.md frontmatter are injected into the system prompt
3. The full SKILL.md instructions are loaded **only when the skill is actually used**
4. This is **progressive disclosure** — minimal token cost until a skill is needed

## Creating a Skill

```
kita/skills/
└── my-skill/
    ├── SKILL.md          # Required: frontmatter + instructions
    ├── scripts/          # Optional: helper scripts
    └── references/       # Optional: reference docs
```

### SKILL.md Format

```markdown
---
name: my-skill
description: What this skill does and when to use it. Be specific — this determines when the AI activates the skill.
---

# My Skill

Instructions for the AI on how to use this skill.
Keep instructions clear and concise — every token counts.

## Usage

Explain the steps, commands, or patterns the AI should follow.
```

### Frontmatter Rules

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Lowercase, hyphens only. Must match folder name. Max 64 chars. |
| `description` | Yes | What the skill does. Max 256 chars. This goes into the system prompt. |

### Description Best Practices

The description is **always in context** (costs tokens every request). Keep it short but specific enough for the AI to know when to activate.

**Good:**
```yaml
description: Summarize and search notes in the user's knowledge base. Use for note-taking, recall, and knowledge queries.
```

**Bad:**
```yaml
description: Helps with notes.
```

## Example Skills

See the template in `kita/skills/_template/SKILL.md` for a starting point.

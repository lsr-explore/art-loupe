# Third-party agent skills (not vendored)

These are **third-party agent skills** — development-time tooling that guides the coding
agent while writing code. They are **not** application runtime dependencies and ship in
no build artifact. Any code produced with their help is the project's own and carries no
license obligation from the skill.

The source of truth is [`skills-lock.json`](../../skills-lock.json) at the repo root, which
pins each skill's upstream source, path, and content hash. The installed skill directories
themselves are **git-ignored** (see `.gitignore`).

## Where they land, and why not here

Despite this file's location, installed skills do **not** live in `.agents/skills/`. The
skills CLI writes to a per-agent directory, and only treats an agent as "universal" — sharing
the canonical `.agents/skills/` tree via symlink — when that agent's own skills directory
*is* `.agents/skills`. Claude Code's is `.claude/skills`, so it gets **copies** in
`.claude/skills/<name>/` instead. This directory stays empty apart from this README unless a
universal agent (Amp, Codex, Cursor, opencode, …) is added later.

## Reinstall

```sh
npx skills add vercel-labs/agent-skills \
  --skill deploy-to-vercel vercel-composition-patterns vercel-optimize \
          vercel-react-best-practices vercel-react-view-transitions \
          web-design-guidelines writing-guidelines \
  --agent claude-code \
  -y
```

Two CLI behaviours are worth knowing, because both make an uninstalled skill look like a
broken one:

- **`npx skills ls` reads the disk, not the lockfile.** It scans agent skill directories for
  `*/SKILL.md`. A skill that is pinned in `skills-lock.json` but not installed simply does not
  appear — that is not an error.
- **`npx skills add` with no package does not restore from the lockfile.** Restoring moved to
  `npx skills experimental_install`, which installs only to *universal* agents and would
  therefore leave Claude Code with nothing. Use the explicit command above.

## Why not vendored

Checking these files into the repo means **redistributing** them, which pulls each skill's
license into play.

| Skill(s) | Upstream | License |
| --- | --- | --- |
| `deploy-to-vercel`, `vercel-composition-patterns`, `vercel-optimize`, `vercel-react-best-practices`, `vercel-react-view-transitions`, `web-design-guidelines`, `writing-guidelines` | [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills) | MIT — permissive, safe to vendor with attribution; kept out of the tree only for repo cleanliness. |

Keeping the tree free of these files avoids the license question entirely: nothing is
redistributed, and the code they helped produce stands on its own.

**Standing caution before adding a skill:** check its license first. Not every published
skill is permissive — [`Intopia/intopia-web-accessibility-skill`](https://github.com/Intopia/intopia-web-accessibility-skill),
for one, is **CC BY-NC-SA 4.0**, whose **NonCommercial** term a commercial repo would violate
by redistributing it. Installing such a skill locally is fine; committing it is not. It is
not currently installed or pinned here.

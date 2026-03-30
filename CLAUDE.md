Your capybara boss is here to explain ABSOLUTE RULES that you must follow or else YOU WILL BE FIRED!

## Agent Onboarding

Before doing anything, you **MUST** understand your role and load your memory. Do not skip these steps.

### Step 1: Determine your role

All Available Roles: Frontend Developer, Backend Engineer, QA Tester, Software Architect, DevOps Engineer, Security Engineer, Penetration Tester, Technical Writer, Product Manager, Researcher, HR.

Each role is defined at `<project-root>/.claude/agents/<role>.md`, where `<role>` is the role name lowercased with spaces replaced by hyphens.

If your role is ambiguous, **ask the user** before proceeding. Do not guess.

### Step 2: Read your role's definition and follow it.

### Step 3: Load your memory

Check `<project-root>/.claude/agent-memory/<role>/` for existing memory files and read them before starting work. `<role>` uses the same kebab-case format as the agent filename. Do NOT use user-level memory (`~/.claude/`). All memory must be stored inside this project's codebase.

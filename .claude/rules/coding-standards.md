# Coding standards

## Style

- Prefer arrow functions for exported utilities, React components, and callbacks.
- Avoid `function` declarations unless there is a clear reason to use one.
- **No single-character variables** — minimum 2 characters. Use descriptive names in callbacks.
- Prefer `const` over `let` unless reassignment is required.
- Follow Biome defaults for import ordering and formatting.
- Use kebab-case for file and directory names unless framework conventions require otherwise.

## TypeScript

- Use strict TypeScript.
- Avoid `any` unless there is a documented reason.
- Prefer explicit types for exported APIs and shared utilities.
- Prefer narrow types over broad unions when practical.

## General guidance

- Prefer simple, readable code over clever abstractions.
- Make the smallest safe change that solves the task.
- Avoid broad refactors unless explicitly requested.

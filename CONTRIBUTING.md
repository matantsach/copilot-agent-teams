# Contributing

Thanks for your interest in contributing to copilot-agent-teams!

## Development Setup

```bash
git clone https://github.com/mtsach/copilot-agent-teams.git
cd copilot-agent-teams
npm install
npm test
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add tests for new functionality
4. Run `npm test` to verify all tests pass
5. Run `npm run build` to verify the build succeeds
6. Submit a pull request

## Project Structure

```
src/
  mcp-server/          # MCP server (coordination brain)
    tools/             # Tool handlers (team, tasks, messaging)
    __tests__/         # Tests using InMemoryTransport
    db.ts              # SQLite state layer
    server.ts          # Server factory (testable)
    index.ts           # Main entry (stdio transport)
    types.ts           # Shared types and schemas
  hooks/               # Lifecycle hooks
    __tests__/         # Hook tests
agents/                # Agent definitions (.agent.md)
skills/                # Skill definitions (SKILL.md)
scripts/               # Helper scripts (spawn-teammate.sh)
dist/                  # Built output (committed for plugin install)
```

## Testing

```bash
npm test              # run all tests
npm run test:watch    # watch mode
```

Tests use vitest with InMemoryTransport for MCP tool testing and child process execution for hook testing.

## Building

```bash
npm run build
```

Bundles with esbuild to `dist/`. The `dist/` directory is committed because `copilot plugin install` does not run build steps.

## Code Style

- TypeScript strict mode
- Zod for all tool input validation
- Errors returned as `{ isError: true }` in MCP tool handlers
- Atomic SQLite transactions for concurrent operations

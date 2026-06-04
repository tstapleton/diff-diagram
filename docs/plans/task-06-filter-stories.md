# Task 6: Filter *.stories.ts Files from Analyzer

## Goal
Storybook story files (`*.stories.ts`) are dev-only files that import components
for documentation purposes. Including them as graph nodes creates false edges and
clutters the dependency diagram. Exclude them from analysis.

## Changes required

### 1. `src/analyzer.ts`
In the `project.addSourceFilesAtPaths()` call, add a glob exclusion for stories:
```typescript
project.addSourceFilesAtPaths([
  path.join(scopeDir, '**/*.ts'),
  `!${path.join(scopeDir, '**/*.spec.ts')}`,
  `!${path.join(scopeDir, '**/*.stories.ts')}`,   // ← new
  `!${path.join(scopeDir, '**/*.d.ts')}`,
  `!${path.join(scopeDir, '**/node_modules/**')}`,
]);
```

### 2. Fixture
Add a stories file to the fake app so the exclusion is testable:
`fake-angular-app/src/app/features/users/user-list/user-card.stories.ts`

Content (minimal Storybook-style):
```typescript
import { UserCardComponent } from './user-card.component';

export default {
  title: 'UserCard',
  component: UserCardComponent,
};

export const Default = {};
```

### 3. Tests

#### `src/analyzer.test.ts`
In the `analyze (integration)` describe block, add to the `beforeAll` fixture setup:
```typescript
writeFileSync(
  path.join(scopeDir, 'users.routes.stories.ts'),
  "import { Component } from '@angular/core';\nexport default {};",
);
```

Add test:
```typescript
it('excludes .stories.ts files', async () => {
  const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
  const files = graph.nodes.map(n => n.file);
  expect(files.every(f => !f.endsWith('.stories.ts'))).toBe(true);
});
```

Also confirm the fake-angular-app fixture file is excluded by verifying no node
in the integration test output has a file ending in `.stories.ts`.

## Validation
- `npm test` — all tests pass, including new stories exclusion test
- `node dist/cli.js --base-dir fake-angular-app-base --out-dir dist fake-angular-app/src/app/features/users`
  — verify `user-card.stories.ts` does not appear in output graph, node count unchanged
  from before adding the fixture file

## Files touched
- `src/analyzer.ts`
- `src/analyzer.test.ts`
- `fake-angular-app/src/app/features/users/user-list/user-card.stories.ts` (new fixture)

## Do NOT touch
- Any other source or test files

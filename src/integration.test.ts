import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { analyze } from './analyzer.js';
import { addContext } from './filter.js';
import { diffGraphs } from './diff-parser.js';
import type { Graph, GraphNode, GraphEdge } from './types.js';

const REPO_ROOT = path.resolve('fake-angular-app');
const BASE_ROOT = path.resolve('fake-angular-app-base');
const SCOPE = path.resolve('fake-angular-app/src/app/features/users');
const BASE_SCOPE = path.resolve('fake-angular-app-base/src/app/features/users');

let diffed: Graph;

beforeAll(async () => {
  const [base, current] = await Promise.all([
    analyze(BASE_SCOPE, { repoRoot: BASE_ROOT }).then(addContext),
    analyze(SCOPE, { repoRoot: REPO_ROOT }).then(addContext),
  ]);
  diffed = diffGraphs(base, current);
}, 30_000);

// ─── helpers ────────────────────────────────────────────────────────────────

function nodeByFile(file: string): GraphNode | undefined {
  return diffed.nodes.find(n => n.file.endsWith(file));
}

function edgeBetween(fromFile: string, toFile: string): GraphEdge | undefined {
  const from = nodeByFile(fromFile);
  const to = nodeByFile(toFile);
  if (!from || !to) return undefined;
  return diffed.edges.find(e => e.from === from.id && e.to === to.id);
}

// ─── node diff states ────────────────────────────────────────────────────────

describe('diffGraphs integration — node diff states', () => {
  it('user-security.component is added (new in PR)', () => {
    const n = nodeByFile('user-settings/user-security.component.ts');
    expect(n).toBeDefined();
    expect(n?.diff).toBe('added');
    expect(n?.scope).toBe('in-scope');
  });

  it('user-notification-prefs.component is added (new in PR)', () => {
    const n = nodeByFile('user-settings/user-notification-prefs.component.ts');
    expect(n).toBeDefined();
    expect(n?.diff).toBe('added');
    expect(n?.scope).toBe('in-scope');
  });

  it('user-search-results.component is a removed-ghost (deleted in PR)', () => {
    const n = nodeByFile('user-list/user-search-results.component.ts');
    expect(n).toBeDefined();
    expect(n?.diff).toBe('removed');
    expect(n?.scope).toBe('removed-ghost');
  });

  it('user-settings.component is modified (gained outgoing edges)', () => {
    const n = nodeByFile('user-settings/user-settings.component.ts');
    expect(n).toBeDefined();
    expect(n?.diff).toBe('modified');
  });

  it('users-list.component is modified (gained/lost outgoing edges)', () => {
    const n = nodeByFile('user-list/users-list.component.ts');
    expect(n).toBeDefined();
    expect(n?.diff).toBe('modified');
  });

  it('user-card.component is unchanged', () => {
    const n = nodeByFile('user-list/user-card.component.ts');
    expect(n).toBeDefined();
    expect(n?.diff).toBe('unchanged');
  });

  it('out-of-scope nodes do not become removed-ghosts', () => {
    const ghosts = diffed.nodes.filter(n => n.scope === 'removed-ghost');
    const oosGhosts = ghosts.filter(n => {
      const original = n.file;
      return !original.startsWith('src/app/features/users');
    });
    expect(oosGhosts).toHaveLength(0);
  });
});

// ─── edge diff states ────────────────────────────────────────────────────────

describe('diffGraphs integration — edge diff states', () => {
  it('edge users-list → user-search-results is removed', () => {
    const e = edgeBetween(
      'user-list/users-list.component.ts',
      'user-list/user-search-results.component.ts',
    );
    expect(e).toBeDefined();
    expect(e?.diff).toBe('removed');
  });

  it('edge users-list → analytics-service (OOS) is added', () => {
    const e = edgeBetween(
      'user-list/users-list.component.ts',
      'shared/services/analytics.service.ts',
    );
    expect(e).toBeDefined();
    expect(e?.diff).toBe('added');
  });

  it('edge user-settings → user-security is added', () => {
    const e = edgeBetween(
      'user-settings/user-settings.component.ts',
      'user-settings/user-security.component.ts',
    );
    expect(e).toBeDefined();
    expect(e?.diff).toBe('added');
  });

  it('edge user-settings → user-notification-prefs is added', () => {
    const e = edgeBetween(
      'user-settings/user-settings.component.ts',
      'user-settings/user-notification-prefs.component.ts',
    );
    expect(e).toBeDefined();
    expect(e?.diff).toBe('added');
  });

  it('edge users-list → pagination (OOS) is unchanged', () => {
    const e = edgeBetween(
      'user-list/users-list.component.ts',
      'shared/components/pagination.component.ts',
    );
    expect(e).toBeDefined();
    expect(e?.diff).toBe('unchanged');
  });

  it('edge user-card → user-status-pipe is unchanged', () => {
    const e = edgeBetween(
      'user-list/user-card.component.ts',
      'shared-ui/user-status.pipe.ts',
    );
    expect(e).toBeDefined();
    expect(e?.diff).toBe('unchanged');
  });
});

// ─── barrel resolution ───────────────────────────────────────────────────────

describe('barrel file resolution', () => {
  it('barrel index.ts is not a node — resolved through to actual source file', () => {
    const barrel = diffed.nodes.find(n => n.file.endsWith('shared/services/index.ts'));
    expect(barrel).toBeUndefined();
  });

  it('only the imported symbol is resolved, not all barrel exports', () => {
    // barrel exports both AnalyticsService and NotificationService,
    // but only AnalyticsService is imported — no edge to notification.service.ts
    const e = edgeBetween(
      'user-list/users-list.component.ts',
      'shared/services/notification.service.ts',
    );
    expect(e).toBeUndefined();
  });

  it('edge users-list → analytics.service is added (barrel-resolved, same as direct import)', () => {
    const e = edgeBetween(
      'user-list/users-list.component.ts',
      'shared/services/analytics.service.ts',
    );
    expect(e).toBeDefined();
    expect(e?.diff).toBe('added');
  });
});

// ─── meta ────────────────────────────────────────────────────────────────────

describe('diffGraphs integration — meta', () => {
  it('nodeCount reflects all nodes including removed-ghosts', () => {
    expect(diffed.meta.nodeCount).toBe(diffed.nodes.length);
  });

  it('edgeCount reflects all edges including removed', () => {
    expect(diffed.meta.edgeCount).toBe(diffed.edges.length);
  });
});

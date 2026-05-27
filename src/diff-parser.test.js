import { describe, it, expect } from 'vitest';
import { parseDiffOutput, applyDiff } from './diff-parser.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeGraph(scopeDir, nodes = [], edges = []) {
  return {
    meta: { repoRoot: '/repo', scopeDir, nodeCount: nodes.length, edgeCount: edges.length },
    nodes,
    edges,
  };
}

function makeNode(file, overrides = {}) {
  const base = file.split('/').at(-1).replace(/\.ts$/, '');
  return {
    id: base.replace(/[^a-zA-Z0-9]/g, '_'),
    label: base,
    file,
    type: 'component',
    scope: 'in-scope',
    diff: null,
    ...overrides,
  };
}

// ─── parseDiffOutput ─────────────────────────────────────────────────────────

describe('parseDiffOutput', () => {
  describe('git --name-status format', () => {
    it('parses M (modified)', () => {
      const result = parseDiffOutput('M\tsrc/app/foo.ts');
      expect(result.get('src/app/foo.ts')).toBe('modified');
    });

    it('parses A (added)', () => {
      const result = parseDiffOutput('A\tsrc/app/foo.ts');
      expect(result.get('src/app/foo.ts')).toBe('added');
    });

    it('parses D (deleted → removed)', () => {
      const result = parseDiffOutput('D\tsrc/app/foo.ts');
      expect(result.get('src/app/foo.ts')).toBe('removed');
    });

    it('parses C (copy → modified)', () => {
      const result = parseDiffOutput('C100\tsrc/app/old.ts\tsrc/app/new.ts');
      expect(result.get('src/app/new.ts')).toBe('modified');
    });

    it('parses R (rename) — old path removed, new path added', () => {
      const result = parseDiffOutput('R100\tsrc/app/old.ts\tsrc/app/new.ts');
      expect(result.get('src/app/old.ts')).toBe('removed');
      expect(result.get('src/app/new.ts')).toBe('added');
    });

    it('handles multiple entries', () => {
      const result = parseDiffOutput('M\tsrc/a.ts\nA\tsrc/b.ts\nD\tsrc/c.ts');
      expect(result.get('src/a.ts')).toBe('modified');
      expect(result.get('src/b.ts')).toBe('added');
      expect(result.get('src/c.ts')).toBe('removed');
    });
  });

  describe('unified diff / format-patch format', () => {
    it('treats diff --git entry as modified by default', () => {
      const result = parseDiffOutput('diff --git a/src/app/foo.ts b/src/app/foo.ts');
      expect(result.get('src/app/foo.ts')).toBe('modified');
    });

    it('upgrades to added when new file mode follows', () => {
      const result = parseDiffOutput(
        'diff --git a/src/app/foo.ts b/src/app/foo.ts\nnew file mode 100644',
      );
      expect(result.get('src/app/foo.ts')).toBe('added');
    });

    it('upgrades to removed when deleted file mode follows', () => {
      const result = parseDiffOutput(
        'diff --git a/src/app/foo.ts b/src/app/foo.ts\ndeleted file mode 100644',
      );
      expect(result.get('src/app/foo.ts')).toBe('removed');
    });

    it('handles rename from/to lines', () => {
      const diff = [
        'diff --git a/src/app/old.ts b/src/app/new.ts',
        'rename from src/app/old.ts',
        'rename to src/app/new.ts',
      ].join('\n');
      const result = parseDiffOutput(diff);
      expect(result.get('src/app/old.ts')).toBe('removed');
      expect(result.get('src/app/new.ts')).toBe('added');
    });
  });

  describe('path normalization', () => {
    it('normalizes Windows backslashes to forward slashes', () => {
      const result = parseDiffOutput('M\tsrc\\app\\foo.ts');
      expect(result.get('src/app/foo.ts')).toBe('modified');
    });

    it('strips leading slashes', () => {
      const result = parseDiffOutput('M\t/src/app/foo.ts');
      expect(result.get('src/app/foo.ts')).toBe('modified');
    });
  });

  describe('non-.ts files', () => {
    it('parses non-.ts entries without filtering (filtering is applyDiff\'s job)', () => {
      const result = parseDiffOutput('M\tsrc/app/README.md\nA\tsrc/app/config.json');
      expect(result.get('src/app/README.md')).toBe('modified');
      expect(result.get('src/app/config.json')).toBe('added');
    });
  });
});

// ─── applyDiff ───────────────────────────────────────────────────────────────

describe('applyDiff', () => {
  describe('applying diff state to existing nodes', () => {
    it('marks a matched node as modified', () => {
      const node = makeNode('src/users/foo.component.ts');
      const graph = makeGraph('src/users', [node]);
      const status = new Map([['src/users/foo.component.ts', 'modified']]);
      const result = applyDiff(graph, status, 'src/users');
      expect(result.nodes[0].diff).toBe('modified');
    });

    it('marks a matched node as added', () => {
      const node = makeNode('src/users/foo.component.ts');
      const graph = makeGraph('src/users', [node]);
      const status = new Map([['src/users/foo.component.ts', 'added']]);
      const result = applyDiff(graph, status, 'src/users');
      expect(result.nodes[0].diff).toBe('added');
    });

    it('sets diff: unchanged on nodes not in the patch', () => {
      const node = makeNode('src/users/foo.component.ts');
      const graph = makeGraph('src/users', [node]);
      const result = applyDiff(graph, new Map(), 'src/users');
      expect(result.nodes[0].diff).toBe('unchanged');
    });
  });

  describe('ghost nodes for removed in-scope .ts files', () => {
    it('adds a ghost node for a removed in-scope file not in the graph', () => {
      const graph = makeGraph('src/users', []);
      const status = new Map([['src/users/foo.component.ts', 'removed']]);
      const result = applyDiff(graph, status, 'src/users');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].scope).toBe('removed-ghost');
      expect(result.nodes[0].diff).toBe('removed');
    });

    it('gives removed ghost node the correct type from its filename, not always component', () => {
      const graph = makeGraph('src/users', []);
      const status = new Map([['src/users/data-access/users.service.ts', 'removed']]);
      const result = applyDiff(graph, status, 'src/users');
      const ghost = result.nodes.find(n => n.scope === 'removed-ghost');
      // BUG: currently returns 'component' — should match filename
      expect(ghost.type).toBe('service');
    });

    it('gives removed .model.ts ghost node type model', () => {
      const graph = makeGraph('src/users', []);
      const status = new Map([['src/users/models/user.model.ts', 'removed']]);
      const result = applyDiff(graph, status, 'src/users');
      const ghost = result.nodes.find(n => n.scope === 'removed-ghost');
      expect(ghost.type).toBe('model');
    });

    it('gives removed .pipe.ts ghost node type pipe', () => {
      const graph = makeGraph('src/users', []);
      const status = new Map([['src/users/shared-ui/user-status.pipe.ts', 'removed']]);
      const result = applyDiff(graph, status, 'src/users');
      const ghost = result.nodes.find(n => n.scope === 'removed-ghost');
      expect(ghost.type).toBe('pipe');
    });

    it('does not add a ghost node for a removed out-of-scope file', () => {
      const graph = makeGraph('src/users', []);
      const status = new Map([['src/shared/api.service.ts', 'removed']]);
      const result = applyDiff(graph, status, 'src/users');
      expect(result.nodes).toHaveLength(0);
    });
  });

  describe('non-.ts files in the patch', () => {
    it('does not create a ghost node for a removed .md file', () => {
      const graph = makeGraph('src/users', []);
      const status = new Map([['src/users/README.md', 'removed']]);
      const result = applyDiff(graph, status, 'src/users');
      // BUG: currently creates a ghost node
      expect(result.nodes).toHaveLength(0);
    });

    it('does not create a node for an added .json file', () => {
      const graph = makeGraph('src/users', []);
      const status = new Map([['src/users/config.json', 'added']]);
      const result = applyDiff(graph, status, 'src/users');
      // BUG: currently creates a node
      expect(result.nodes).toHaveLength(0);
    });

    it('does not update diff state on existing nodes for non-.ts patch entries', () => {
      const node = makeNode('src/users/foo.component.ts');
      const graph = makeGraph('src/users', [node]);
      // Only a .md change — the .ts node should be unchanged
      const status = new Map([['src/users/README.md', 'modified']]);
      const result = applyDiff(graph, status, 'src/users');
      expect(result.nodes[0].diff).toBe('unchanged');
      expect(result.nodes).toHaveLength(1);
    });
  });

  describe('added in-scope files not yet in the graph', () => {
    it('adds a new node for an added in-scope .ts file', () => {
      const graph = makeGraph('src/users', []);
      const status = new Map([['src/users/new.component.ts', 'added']]);
      const result = applyDiff(graph, status, 'src/users');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].diff).toBe('added');
      expect(result.nodes[0].scope).toBe('in-scope');
    });

    it('classifies the new node type from its filename', () => {
      const graph = makeGraph('src/users', []);
      const status = new Map([['src/users/new-export.service.ts', 'added']]);
      const result = applyDiff(graph, status, 'src/users');
      expect(result.nodes[0].type).toBe('service');
    });
  });

  describe('output shape', () => {
    it('does not mutate the input graph', () => {
      const node = makeNode('src/users/foo.component.ts');
      const graph = makeGraph('src/users', [node]);
      const status = new Map([['src/users/foo.component.ts', 'modified']]);
      applyDiff(graph, status, 'src/users');
      expect(graph.nodes[0].diff).toBeNull();
    });

    it('updates nodeCount in meta', () => {
      const graph = makeGraph('src/users', []);
      const status = new Map([['src/users/new.component.ts', 'added']]);
      const result = applyDiff(graph, status, 'src/users');
      expect(result.meta.nodeCount).toBe(1);
    });
  });
});

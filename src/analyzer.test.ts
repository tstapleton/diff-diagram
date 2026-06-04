import path from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { toNodeId, labelFromFile, classifyByFilename, analyze } from './analyzer.js';

// ─── toNodeId ────────────────────────────────────────────────────────────────

describe('toNodeId', () => {
  it('produces a repo-relative id with .ts stripped', () => {
    expect(toNodeId('/repo/src/app/foo.component.ts', '/repo')).toBe('src_app_foo_component');
  });

  it('replaces non-alphanumeric characters with underscores', () => {
    expect(toNodeId('/repo/src/app/user-list/user-list.component.ts', '/repo'))
      .toBe('src_app_user_list_user_list_component');
  });

  it('collapses consecutive underscores', () => {
    expect(toNodeId('/repo/src/app/foo--bar.ts', '/repo')).toBe('src_app_foo_bar');
  });

  it('trims leading and trailing underscores', () => {
    const result = toNodeId('/repo/src/app/foo.ts', '/repo');
    expect(result).not.toMatch(/^_|_$/);
  });

  it('handles nested directories', () => {
    expect(toNodeId('/repo/src/app/features/users/data-access/users.service.ts', '/repo'))
      .toBe('src_app_features_users_data_access_users_service');
  });
});

// ─── labelFromFile ───────────────────────────────────────────────────────────

describe('labelFromFile', () => {
  it('converts kebab-case to PascalCase and strips .ts', () => {
    expect(labelFromFile('/any/path/user-list.component.ts')).toBe('UserListComponent');
  });

  it('handles a single-segment filename', () => {
    expect(labelFromFile('/any/path/users.service.ts')).toBe('UsersService');
  });

  it('handles a filename with no hyphens', () => {
    expect(labelFromFile('/any/path/auth.guard.ts')).toBe('AuthGuard');
  });

  it('handles deeply nested paths', () => {
    expect(labelFromFile('/deep/a/b/c/user-status.pipe.ts')).toBe('UserStatusPipe');
  });

  it('uses parent directory name for barrel index files', () => {
    expect(labelFromFile('/src/app/shared/lookup-entity/index.ts')).toBe('LookupEntity');
  });
});

// ─── classifyByFilename ──────────────────────────────────────────────────────

describe('classifyByFilename', () => {
  it('returns routing for .routes.ts', () => {
    expect(classifyByFilename('users.routes.ts')).toBe('routing');
  });

  it('returns guard for .guard.ts', () => {
    expect(classifyByFilename('auth.guard.ts')).toBe('guard');
  });

  it('returns resolver for .resolver.ts', () => {
    expect(classifyByFilename('user.resolver.ts')).toBe('resolver');
  });

  it('returns interceptor for .interceptor.ts', () => {
    expect(classifyByFilename('http.interceptor.ts')).toBe('interceptor');
  });

  it('returns model for .model.ts', () => {
    expect(classifyByFilename('user.model.ts')).toBe('model');
  });

  it('returns model for .interface.ts', () => {
    expect(classifyByFilename('user.interface.ts')).toBe('model');
  });

  it('returns null for .service.ts (needs decorator inspection)', () => {
    expect(classifyByFilename('users.service.ts')).toBeNull();
  });

  it('returns null for .component.ts (needs decorator inspection)', () => {
    expect(classifyByFilename('user-list.component.ts')).toBeNull();
  });

  it('returns null for .pipe.ts (needs decorator inspection)', () => {
    expect(classifyByFilename('user-status.pipe.ts')).toBeNull();
  });

  it('returns null for plain .ts files', () => {
    expect(classifyByFilename('validation.utils.ts')).toBeNull();
  });

  it('works with full paths', () => {
    expect(classifyByFilename('/repo/src/app/features/users/users.routes.ts')).toBe('routing');
  });
});

// ─── analyze() — integration tests ──────────────────────────────────────────
// These tests run ts-morph against a real (temporary) fixture directory.

describe('analyze (integration)', { timeout: 15000 }, () => {
  let tmpRoot;
  let scopeDir;

  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'diff-diagram-test-'));
    scopeDir = path.join(tmpRoot, 'src', 'app', 'features', 'users');
    mkdirSync(scopeDir, { recursive: true });

    // In-scope: a .ts file that should appear in output
    writeFileSync(
      path.join(scopeDir, 'users.routes.ts'),
      'export const routes = [];',
    );

    // Should be excluded: spec file
    writeFileSync(
      path.join(scopeDir, 'users.routes.spec.ts'),
      'describe("test", () => {});',
    );

    // Should be excluded: declaration file
    writeFileSync(
      path.join(scopeDir, 'generated.d.ts'),
      'export declare const x: string;',
    );

    // Should be excluded: stories file
    writeFileSync(
      path.join(scopeDir, 'users.routes.stories.ts'),
      "import { Component } from '@angular/core';\nexport default {};",
    );

    // Should be excluded: node_modules inside scope (BUG: currently included)
    const nmDir = path.join(scopeDir, 'node_modules', 'some-lib');
    mkdirSync(nmDir, { recursive: true });
    writeFileSync(path.join(nmDir, 'index.ts'), 'export const lib = {};');
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('includes the in-scope .ts file', async () => {
    const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
    const files = graph.nodes.map(n => n.file);
    expect(files.some(f => f.includes('users.routes'))).toBe(true);
  });

  it('excludes .spec.ts files', async () => {
    const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
    const files = graph.nodes.map(n => n.file);
    expect(files.every(f => !f.includes('.spec.'))).toBe(true);
  });

  it('excludes .d.ts declaration files', async () => {
    const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
    const files = graph.nodes.map(n => n.file);
    expect(files.every(f => !f.endsWith('.d'))).toBe(true);
  });

  it('excludes files inside node_modules', async () => {
    const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
    const files = graph.nodes.map(n => n.file);
    // BUG: currently includes node_modules files
    expect(files.every(f => !f.includes('node_modules'))).toBe(true);
  });

  it('classifies .routes.ts as routing type', async () => {
    const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
    const routesNode = graph.nodes.find(n => n.file.includes('users.routes'));
    expect(routesNode?.type).toBe('routing');
  });

  it('excludes .stories.ts files', async () => {
    const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
    const files = graph.nodes.map(n => n.file);
    expect(files.every(f => !f.endsWith('.stories.ts'))).toBe(true);
  });
});

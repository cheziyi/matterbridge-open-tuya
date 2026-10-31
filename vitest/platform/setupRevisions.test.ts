/**
 * @file vitest/platform/setupRevisions.test.ts
 * @description This file contains the tests for the count of the configurations the plugin stored itself.
 * @author Calvin Che
 */

/* oxlint-disable unicorn/no-useless-undefined */

import { parseSetupRevision, SetupRevisions } from '../../src/platform/setupRevisions.js';

describe('setupRevisions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('should read a stored revision, and 0 for anything else', () => {
    expect(parseSetupRevision(7)).toBe(7);
    expect(parseSetupRevision(0)).toBe(0);
    expect(parseSetupRevision(-1)).toBe(0);
    expect(parseSetupRevision(1.5)).toBe(0);
    expect(parseSetupRevision('7')).toBe(0);
    expect(parseSetupRevision(undefined)).toBe(0);
  });

  test('should count on from the stored revision', () => {
    const revisions = new SetupRevisions(4);
    expect(revisions.current).toBe(4);
    expect(revisions.advance()).toBe(5);
    expect(revisions.current).toBe(5);
  });

  test('should know a configuration it stored once, and those stored before it', () => {
    const revisions = new SetupRevisions(undefined);
    revisions.advance();
    revisions.advance();
    revisions.advance();
    // A configuration of the config editor comes back with a revision the plugin did not just store.
    expect(revisions.acknowledge(0)).toBe(false);
    expect(revisions.acknowledge(2)).toBe(true);
    expect(revisions.acknowledge(1)).toBe(false);
    expect(revisions.acknowledge(2)).toBe(false);
    expect(revisions.acknowledge(3)).toBe(true);
  });

  test('should stop expecting a configuration that did not come back within 10 seconds', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const revisions = new SetupRevisions(0);
    revisions.advance();
    clock.mockReturnValue(11_000);
    expect(revisions.acknowledge(1)).toBe(false);
  });
});

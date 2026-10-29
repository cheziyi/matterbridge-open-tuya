/**
 * @file src/platform/setupRevisions.ts
 * @description This file contains the count of the configurations the plugin stored itself, which tells them from one saved in the config editor.
 * @author Calvin Che
 * @created 2026-10-29
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2026 Calvin Che.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { isValidInteger } from 'matterbridge/utils';

/** How long, in milliseconds, a configuration this plugin stored is expected back through `onConfigChanged`. */
const ownSaveLifetimeInMs = 10_000;

/**
 * Read the revision a configuration was stored under
 *
 * @param {unknown} value The stored `setupRevision`.
 * @returns {number} The revision, or 0 when the value is not a whole number of 0 or more.
 */
export function parseSetupRevision(value: unknown): number {
  return isValidInteger(value, 0) ? value : 0;
}

/**
 * How many times this plugin stored the account or the devices itself
 *
 * The number is stored with them, so a configuration that comes back with another number was loaded before the last of
 * those changes: see `TuyaPlatform.onConfigChanged`.
 */
export class SetupRevisions {
  private revision: number;
  /** The revisions this plugin stored and has not seen come back through `onConfigChanged` yet. */
  private ownSaves: { revision: number; storedAt: number }[] = [];

  /**
   * Start counting from the stored configuration
   *
   * @param {unknown} stored The stored `setupRevision`.
   */
  constructor(stored: unknown) {
    this.revision = parseSetupRevision(stored);
  }

  /**
   * Get the revision of the configuration as the plugin holds it
   *
   * @returns {number} The revision.
   */
  get current(): number {
    return this.revision;
  }

  /**
   * Count a configuration the plugin is about to store
   *
   * @returns {number} The revision to store it under.
   */
  advance(): number {
    this.revision += 1;
    this.ownSaves.push({ revision: this.revision, storedAt: Date.now() });
    return this.revision;
  }

  /**
   * Tell whether a configuration that came back is one this plugin stored itself, and stop expecting it
   *
   * Edge cases:
   *  - a configuration stored more than 10 seconds ago is no longer expected
   *  - the configurations stored before the one that came back are no longer expected either
   *
   * @param {number} revision The revision the configuration came back with.
   * @returns {boolean} True when the plugin stored it, so there is nothing in it to apply.
   */
  acknowledge(revision: number): boolean {
    this.ownSaves = this.ownSaves.filter((save) => Date.now() - save.storedAt < ownSaveLifetimeInMs);
    const ownSave = this.ownSaves.findIndex((save) => save.revision === revision);
    if (ownSave === -1) return false;
    this.ownSaves.splice(0, ownSave + 1);
    return true;
  }
}

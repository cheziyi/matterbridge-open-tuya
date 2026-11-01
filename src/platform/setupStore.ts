/**
 * @file src/platform/setupStore.ts
 * @description This file contains the storage of the account and the devices, with the secrets among them.
 * @author Calvin Che
 * @created 2026-11-01
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

import { isValidObject } from 'matterbridge/utils';
import type { NodeStorage } from 'node-persist-manager';

import { ignoreFailure } from '../errors.js';

const setupKey = 'setup';

/** The account and the devices as they are stored, or what another version left there: `parseAccountConfig` and `parseDeviceConfigs` read them. */
export interface StoredSetup {
  account?: unknown;
  devices?: unknown;
}

/**
 * The account and the devices, kept in the storage of the platform
 *
 * They hold the session of the account, the secret of a cloud project and the local key of each device. Matterbridge
 * hands the configuration of a plugin to its config editor, in the browser, so none of them is stored there.
 */
export class SetupStore {
  private readonly getStorage: () => NodeStorage | undefined;
  // Written one after the other: each refresh of a session replaces a refresh token that works once, so the last write has to win.
  private writes: Promise<void> = Promise.resolve();

  /**
   * Create the store
   *
   * @param {() => NodeStorage | undefined} getStorage Gets the platform storage, which is not there until the platform is ready.
   */
  constructor(getStorage: () => NodeStorage | undefined) {
    this.getStorage = getStorage;
  }

  /**
   * Read the account and the devices
   *
   * @returns {Promise<StoredSetup>} What is stored, or nothing when what is stored is not an object.
   */
  async read(): Promise<StoredSetup> {
    const stored: unknown = await this.getStorage()?.get(setupKey);
    return isValidObject(stored) ? { ...stored } : {};
  }

  /**
   * Store the account and the devices, after the writes going on
   *
   * @param {StoredSetup} setup What to store.
   * @returns {Promise<void>} Resolves when it is stored.
   */
  async write(setup: StoredSetup): Promise<void> {
    const result = this.writes.then(async () => this.getStorage()?.set(setupKey, setup));
    this.writes = result.then(ignoreFailure, ignoreFailure);
    return result;
  }

  /**
   * Wait for the writes going on
   *
   * @returns {Promise<void>} Resolves when they ended, whichever way.
   */
  async flush(): Promise<void> {
    await this.writes;
  }
}

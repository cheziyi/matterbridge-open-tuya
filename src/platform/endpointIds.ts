/**
 * @file src/platform/endpointIds.ts
 * @description This file contains the endpoint ids of a device, which give an endpoint that comes back after it was taken away a new id, and the store that keeps them between restarts.
 * @author Calvin Che
 * @created 2026-10-25
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

import { isValidInteger, isValidObject } from 'matterbridge/utils';
import type { NodeStorage } from 'node-persist-manager';

import type { TuyaDeviceConfig } from '../config.js';

/** The endpoint ids of a device, as they are stored. */
export interface StoredEndpointIds {
  /** The base ids of the endpoints the device was built with last. */
  built: string[];
  /** How many times each base id was brought back after it was taken away, which is the count after it in its endpoint id. A base id never brought back is left out. */
  generations: Record<string, number>;
}

/** The device whose ids are kept: only its device ID is read. */
type StoredMachine = Pick<TuyaDeviceConfig, 'deviceId'>;

/**
 * Tell whether a stored value is the endpoint ids of a device
 *
 * @param {unknown} value The stored value.
 * @returns {boolean} True when the base ids are strings and the counts are whole numbers of 1 or more.
 */
export function isStoredEndpointIds(value: unknown): value is StoredEndpointIds {
  if (!isValidObject(value)) return false;
  const stored: Record<string, unknown> = { ...value };
  if (!Array.isArray(stored.built) || !stored.built.every((id) => typeof id === 'string')) return false;
  if (!isValidObject(stored.generations)) return false;
  const generations: Record<string, unknown> = { ...stored.generations };
  return Object.values(generations).every((generation) => isValidInteger(generation, 1));
}

/**
 * The endpoint ids of a device, which give an endpoint that comes back after it was taken away a new id
 *
 * matter.js keeps the endpoint number of every id it has seen, and gives it back to an endpoint with that id, whether
 * or not the endpoint was there meanwhile. Apple Home cannot change the settings of a device that comes back under the
 * number it had before it was taken away: it takes it for the one it knew, which is gone. So an endpoint that was not
 * built last time gets a new id, with a count after its base id, and matter.js gives it a new number. The endpoints that
 * stay keep their ids, and their numbers with them. The ids outlive a removal of the device, since the numbers of the
 * endpoints it no longer had are not erased then.
 */
export class EndpointIds {
  private readonly isFirstBuild: boolean;
  private readonly builtBefore: ReadonlySet<string>;
  private readonly generations: Record<string, number>;
  private readonly built: string[] = [];

  /**
   * Start from the stored ids
   *
   * @param {StoredEndpointIds} [stored] The ids as they were stored. Left out for a device never built before, whose every endpoint gets its base id.
   */
  constructor(stored?: StoredEndpointIds) {
    this.isFirstBuild = stored === undefined;
    this.builtBefore = new Set(stored?.built);
    this.generations = { ...stored?.generations };
  }

  /**
   * Get the endpoint id for a base id, and count the endpoint among the ones built
   *
   * Edge cases:
   *  - a base id built last time, or any base id of a device never built before -> the id it had, which is the base id with its count after it when it was ever brought back
   *  - a base id not built last time -> the base id with a count one higher than it had
   *
   * @param {string} base The base id: the device ID for the main endpoint, that with what tells the endpoint apart after a dash for a device of its own beside it, or what tells a part apart.
   * @returns {string} The endpoint id.
   */
  resolve(base: string): string {
    if (!this.isFirstBuild && !this.builtBefore.has(base)) this.generations[base] = (this.generations[base] ?? 0) + 1;
    this.built.push(base);
    const generation = this.generations[base];
    return generation === undefined ? base : `${base}-${generation}`;
  }

  /**
   * Describe the ids for storage, once the device is built
   *
   * @returns {StoredEndpointIds} The base ids built and the counts.
   */
  toStore(): StoredEndpointIds {
    return { built: [...this.built], generations: { ...this.generations } };
  }
}

/**
 * Get the key the endpoint ids of a device are stored under
 *
 * They are kept under its device ID, so that a new name keeps them.
 *
 * @param {StoredMachine} device The device.
 * @returns {string} The storage key.
 */
function getKey(device: StoredMachine): string {
  return `endpointIds:${device.deviceId}`;
}

/**
 * The endpoint ids of each device, kept between restarts so that an endpoint that comes back gets a new id
 *
 * They outlive a removal of the device: added again, it gives an endpoint that was taken away before a new id.
 */
export class EndpointIdStore {
  private readonly getStorage: () => NodeStorage | undefined;

  /**
   * Create the store
   *
   * @param {() => NodeStorage | undefined} getStorage Gets the platform storage, which is not there until the platform is ready.
   */
  constructor(getStorage: () => NodeStorage | undefined) {
    this.getStorage = getStorage;
  }

  /**
   * Read the endpoint ids a device was built with
   *
   * @param {StoredMachine} device The device.
   * @returns {Promise<StoredEndpointIds | undefined>} The stored ids, or undefined when none are stored or they cannot be read.
   */
  async read(device: StoredMachine): Promise<StoredEndpointIds | undefined> {
    const stored: unknown = await this.getStorage()?.get(getKey(device));
    return isStoredEndpointIds(stored) ? stored : undefined;
  }

  /**
   * Store the endpoint ids a device was built with
   *
   * @param {StoredMachine} device The device.
   * @param {StoredEndpointIds} ids The ids.
   * @returns {Promise<void>} Resolves when the ids are stored.
   */
  async write(device: StoredMachine, ids: StoredEndpointIds): Promise<void> {
    await this.getStorage()?.set(getKey(device), ids);
  }
}

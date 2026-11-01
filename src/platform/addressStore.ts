/**
 * @file src/platform/addressStore.ts
 * @description This file contains the store of the address each device was last heard at on the LAN.
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

import { isValidObject } from 'matterbridge/utils';
import type { NodeStorage } from 'node-persist-manager';
import type { ProtocolVersion } from 'open-tuya';

import { isMember, LAN_VERSIONS, normalizeHost } from '../config.js';

/** Where a device is on the LAN: its address and the protocol version it speaks there. */
export interface LanAddress {
  host: string;
  version: ProtocolVersion;
}

/**
 * Read a stored value as an address on the LAN
 *
 * @param {unknown} value The stored value.
 * @returns {LanAddress | undefined} The address, or undefined when the host or the version is not valid.
 */
export function parseLanAddress(value: unknown): LanAddress | undefined {
  if (!isValidObject(value)) return undefined;
  const raw: Record<string, unknown> = { ...value };
  const host = normalizeHost(raw.host);
  return host !== undefined && isMember(LAN_VERSIONS, raw.version) ? { host, version: raw.version } : undefined;
}

/**
 * Get the key the address of a device is stored under
 *
 * @param {string} deviceId The device ID.
 * @returns {string} The storage key.
 */
function getKey(deviceId: string): string {
  return `lan:${deviceId}`;
}

/**
 * The address each device was last heard at on the LAN, kept between restarts
 *
 * A device broadcasts every few seconds, but a device that starts with the address it had is reached on the LAN at
 * once, and the discovery follows it to a new address from there.
 */
export class AddressStore {
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
   * Read the address a device was last heard at
   *
   * @param {string} deviceId The device ID.
   * @returns {Promise<LanAddress | undefined>} The address, or undefined when none is stored or it cannot be read.
   */
  async read(deviceId: string): Promise<LanAddress | undefined> {
    return parseLanAddress(await this.getStorage()?.get(getKey(deviceId)));
  }

  /**
   * Store the address a device was heard at
   *
   * @param {string} deviceId The device ID.
   * @param {LanAddress} address The address.
   * @returns {Promise<void>} Resolves when the address is stored.
   */
  async write(deviceId: string, address: LanAddress): Promise<void> {
    await this.getStorage()?.set(getKey(deviceId), { host: address.host, version: address.version });
  }

  /**
   * Forget the address of a device
   *
   * @param {string} deviceId The device ID.
   * @returns {Promise<void>} Resolves when the address is removed.
   */
  async remove(deviceId: string): Promise<void> {
    await this.getStorage()?.remove(getKey(deviceId));
  }
}

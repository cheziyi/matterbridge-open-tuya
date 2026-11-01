/**
 * @file apps/frontend/src/state.ts
 * @description What the setup page knows at any moment, and what it reads from that.
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

import type { DataCenter, DeviceFeatures, Exposure, LanVersion, ListedDevice, ProbeResult, QrLoginState, SetupState } from './api.js';

/** What the page knows of the device a draft is about: what the Tuya cloud lists of it. */
export interface DraftDevice {
  deviceId: string;
  /** Its name in the Smart Life app. */
  cloudName?: string;
  productKey: string;
  category?: string;
}

/** One device on its way through Connect and Options. */
export interface Draft extends Exposure {
  device: DraftDevice;
  name: string;
  /** The host the device is reached at on the LAN, or empty to find it there by its broadcasts. */
  host: string;
  /** The protocol version it speaks at `host`, or empty while no host is given. */
  version: LanVersion | '';
  /** Whether the device is reached through the Tuya cloud alone, never on the LAN. */
  isCloudOnly: boolean;
  isNew: boolean;
  /** The catalog entry the controls are named by, once the plugin found it. */
  catalogFile?: string;
  /** The cloud's model of the device, which the controls are named by when the catalog does not list its product. */
  model?: ProbeResult['model'];
  productName?: string;
  /** What the device can show in Matter, once the plugin read it. */
  features?: DeviceFeatures;
  /** The controls the device last reported. */
  values?: ProbeResult['values'];
  probe?: ProbeResult;
}

export type ScreenName = 'loading' | 'home' | 'signIn' | 'find' | 'connect' | 'options' | 'done';

/** The sign in: by QR code with the Smart Life app, or with a cloud project of the Tuya developer platform. */
export interface SignIn {
  method: 'smartLife' | 'developer';
  userCode: string;
  accessId: string;
  dataCenter: DataCenter;
}

/** What the page knows at any moment: the screen it is on, the state the plugin sent, and what the user is doing. */
export const view = {
  screen: 'loading' as ScreenName,
  setup: undefined as SetupState | undefined,
  signIn: { method: 'smartLife', userCode: '', accessId: '', dataCenter: 'eu' } as SignIn,
  /** The sign in by QR code, as the plugin last told it. */
  login: { status: 'idle' } as QrLoginState,
  devices: [] as ListedDevice[],
  selected: new Set<string>(),
  queue: [] as Draft[],
  saved: [] as string[],
  /** The devices this run is done with, in the order it went through them. */
  handled: [] as { label: string; isSaved: boolean }[],
  isBusy: false,
  busyText: '',
  error: '',
  /** A note for the user that is no problem, such as what to do after a change. */
  info: '',
  confirmingRemoval: '',
  confirmingSignOut: false,
};

/**
 * Get the device the run is on
 *
 * @returns {Draft | undefined} The device, or undefined when no run is going on.
 */
export function currentDraft(): Draft | undefined {
  return view.queue[0];
}

/**
 * Get what a device is called on the page: its name, or its device ID until it has one
 *
 * @param {Draft} draft The device.
 * @returns {string} The name, or the device ID.
 */
export function draftLabel(draft: Draft): string {
  return draft.name === '' ? draft.device.deviceId : draft.name;
}

/**
 * Describe a device as the Smart Life app knows it, to tell it apart: its product, its device ID and its name there
 *
 * @param {DraftDevice} device The device.
 * @param {string} [productName] The name the product is sold under, once the plugin found it.
 * @returns {string} The description.
 */
export function deviceLabel(device: DraftDevice, productName?: string): string {
  const product = productName === undefined ? 'device' : productName;
  return device.cloudName === undefined ? `${product} ${device.deviceId}` : `${product} ${device.deviceId}, named "${device.cloudName}" in the Smart Life app`;
}

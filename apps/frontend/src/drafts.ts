/**
 * @file apps/frontend/src/drafts.ts
 * @description The drafts the Connect and Options steps work on, and the choices of how a device appears in Matter.
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

import type { DeviceFeatures, Exposure, ListedDevice, StoredDevice } from './api.js';
import { type Draft, view } from './state.js';

/** The longest name Matter takes. */
const maxNameLength = 32;

/** Copy the choices of how a device appears in Matter, and nothing else. */
export function pickExposure(source: Exposure): Exposure {
  return { hiddenFeatures: [...source.hiddenFeatures], addedFeatures: [...source.addedFeatures], isComposed: source.isComposed };
}

/** The feature that is the device itself, and always shown: its first outlet, or its first sensor when it has no outlet. */
export function mainFeatureId(features: DeviceFeatures): string | undefined {
  return (features.outlets[0] ?? features.sensors[0])?.id;
}

/**
 * Drop the choices a device has no use for: a feature it does not have is neither left out nor added, so that the
 * options stored are those of what it can do.
 */
export function fitExposure(exposure: Exposure, features: DeviceFeatures): Exposure {
  const main = mainFeatureId(features);
  const shown = new Set([...features.outlets, ...features.sensors].map((feature) => feature.id).filter((id) => id !== main));
  if (features.meter !== undefined && features.outlets.length > 0) shown.add('meter');
  const added = new Set(features.settingSwitches.map((feature) => feature.id));
  return {
    hiddenFeatures: exposure.hiddenFeatures.filter((id) => shown.has(id)),
    addedFeatures: exposure.addedFeatures.filter((id) => added.has(id)),
    isComposed: exposure.isComposed,
  };
}

/** A name no device has yet: the name in the Smart Life app, or that name with a number after it, such as "Desk Lamp 2". */
function uniqueName(base: string, taken: ReadonlySet<string>): string {
  const trimmed = base.trim().slice(0, maxNameLength).trimEnd();
  if (trimmed === '' || !taken.has(trimmed)) return trimmed;
  for (let count = 2; ; count++) {
    const suffix = ` ${count}`;
    const name = `${trimmed.slice(0, maxNameLength - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * The drafts of the devices picked in the Find step, each named after its name in the Smart Life app. Two devices can
 * share a name there, so each draft gets one no stored device and no draft before it has.
 */
export function draftsFromDevices(devices: readonly ListedDevice[]): Draft[] {
  const taken = new Set((view.setup?.devices ?? []).map((device) => device.name));
  return devices.map((listed) => {
    const name = uniqueName(listed.name, taken);
    taken.add(name);
    return {
      device: { deviceId: listed.deviceId, cloudName: listed.name, productKey: listed.productKey, category: listed.category },
      name,
      host: '',
      version: '',
      isCloudOnly: false,
      isNew: true,
      hiddenFeatures: [],
      addedFeatures: [],
      isComposed: true,
    };
  });
}

export function draftFromStored(device: StoredDevice): Draft {
  return {
    device: { deviceId: device.deviceId, cloudName: device.cloudName, productKey: device.productKey, category: device.category },
    name: device.name,
    host: device.host ?? '',
    version: device.version ?? '',
    isCloudOnly: device.isCloudOnly ?? false,
    isNew: false,
    catalogFile: device.catalogFile,
    model: device.model,
    productName: device.productName,
    features: device.features,
    values: device.values,
    ...pickExposure(device),
  };
}

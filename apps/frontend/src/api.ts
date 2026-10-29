/**
 * @file apps/frontend/src/api.ts
 * @description What the plugin's API sends and takes, and the call to it: see src/setup/setupApi.ts in the plugin.
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

import type { DATA_CENTERS, LAN_VERSIONS } from '../../../src/config.js';
import type { SetupReplies, SetupReply } from '../../../src/setup/setupApi.js';

// The types are the plugin's own, so the page and the plugin cannot drift apart. They are only types: nothing of the
// plugin is loaded in the browser. The page has its own words for some of them.
export type { TuyaDeviceExposure as Exposure } from '../../../src/config.js';
export type { ControlRef, DeviceFeatures, SensorFeature, SwitchFeature } from '../../../src/features.js';
export type { DeviceSupport, ProbeResult } from '../../../src/setup/probe.js';
export type { FoundDevice as ListedDevice, QrLoginState, SetupAccount, SetupDevice as StoredDevice, SetupState } from '../../../src/setup/setupApi.js';

/** A data center of the Tuya developer platform, such as `eu`. */
export type DataCenter = (typeof DATA_CENTERS)[number];

/** A protocol version a device speaks on the LAN, such as `3.3`. */
export type LanVersion = (typeof LAN_VERSIONS)[number];

/** A request the plugin serves, by its method and its path after `api/`. */
export type Route = keyof SetupReplies;

/** The reply to a request, with what the plugin sends back when the request worked. */
export type Reply<R extends Route> = ({ ok: true } & SetupReplies[R]) | Extract<SetupReply, { ok: false }>;

/** The data centers of the Tuya developer platform, as the page names them: `DATA_CENTERS` in the plugin. */
export const dataCenterNames: Readonly<Record<DataCenter, string>> = {
  'cn': 'China',
  'us': 'Western America',
  'us-e': 'Eastern America',
  'eu': 'Central Europe',
  'eu-w': 'Western Europe',
  'in': 'India',
  'sg': 'Singapore',
};

/** The protocol versions a device speaks on the LAN: `LAN_VERSIONS` in the plugin. */
export const lanVersions: readonly LanVersion[] = ['3.1', '3.2', '3.3', '3.4', '3.5'];

/** The id of the meter of the main outlet among the features left out: `meterFeatureId` in the plugin. */
export const meterFeatureId = 'meter';

/**
 * Call the plugin.
 *
 * @param route The method and the path, such as `POST probe`.
 * @param body The JSON body.
 * @param query The query string, without its `?`.
 * @returns The reply, with `ok: false` and the reason when the call did not work.
 */
export async function api<R extends Route>(route: R, body?: unknown, query?: string): Promise<Reply<R>> {
  try {
    const [method, path] = route.split(' ');
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const response = await fetch(new URL(`api/${path}${query === undefined ? '' : `?${query}`}`, document.baseURI), init);
    if (response.status === 204) return { ok: true } as Reply<R>;
    if (response.status === 503) return { ok: false, error: 'The plugin is not running. Start it in Matterbridge, then reload this page.' };
    const reply = (await response.json()) as Reply<R> | { error?: string };
    if ('ok' in reply) return reply;
    return { ok: false, error: reply.error ?? `The plugin answered with status ${response.status}` };
  } catch {
    return { ok: false, error: 'Matterbridge did not answer. Check that it is running, then try again.' };
  }
}

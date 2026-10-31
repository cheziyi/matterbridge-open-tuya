/**
 * @file apps/frontend/src/screens/home.ts
 * @description The home of the setup page: the account, and the devices set up with how each is doing.
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

import { loadState, removeDevice, search, signOut, startQueue, startSignIn } from '../actions.js';
import { dataCenterNames, meterFeatureId, type StoredDevice } from '../api.js';
import { button, notice } from '../components.js';
import { type Child, h } from '../dom.js';
import { draftFromStored, mainFeatureId } from '../drafts.js';
import { describeReadings } from '../readings.js';
import { render } from '../render.js';
import { view } from '../state.js';

function joinList(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// Such as "an outlet, Outlet 2 and Outlet 3, the meter and a switch for the child lock, all as one device".
function describeExposure(device: StoredDevice): string {
  const { features } = device;
  if (features === undefined) return 'as it was set up';
  const main = mainFeatureId(features);
  const isShown = (id: string): boolean => id !== main && !device.hiddenFeatures.includes(id);
  const outlets = features.outlets.filter((outlet) => isShown(outlet.id)).map((outlet) => outlet.label);
  const sensors = features.sensors.filter((sensor) => isShown(sensor.id)).map((sensor) => sensor.label.toLowerCase());
  const settings = features.settingSwitches.filter((setting) => device.addedFeatures.includes(setting.id)).map((setting) => setting.label.toLowerCase());
  const first = features.outlets.length > 0 ? 'an outlet' : `a ${features.sensors[0]?.label.toLowerCase() ?? ''} sensor`;
  const parts = [first];
  if (outlets.length > 0) parts.push(joinList(outlets));
  if (features.meter !== undefined && features.outlets.length > 0 && !device.hiddenFeatures.includes(meterFeatureId)) parts.push('the meter');
  if (sensors.length > 0) parts.push(`a sensor for the ${joinList(sensors)}`);
  if (settings.length > 0) parts.push(`a switch for the ${joinList(settings)}`);
  if (features.battery !== undefined) parts.push('its battery');
  const isSeveral = parts.length > 1 || outlets.length > 1;
  return `${joinList(parts)}${isSeveral ? (device.isComposed ? ', all as one device' : ', each a device of its own') : ''}`;
}

// Where a device that is online is reached.
const routeNames = { lan: ' on your network', cloud: ' through the Tuya cloud' } as const;

// A device that answers through the cloud was not reached on the LAN, where the plugin tries it first.
function routeLine(device: StoredDevice): Child {
  if (device.status !== 'online' || device.route !== 'cloud' || device.isCloudOnly === true) return null;
  if (device.hasLan) {
    return h('p', { class: 'meta' }, 'It did not answer on your network, so the plugin reaches it through the Tuya cloud.');
  }
  return h(
    'p',
    { class: 'meta' },
    'It was not heard on your network, so the plugin reaches it through the Tuya cloud. Where the plugin cannot hear it, such as on another subnet, enter its IP address in its options.',
  );
}

function deviceRow(device: StoredDevice): HTMLElement {
  const online = `Online${device.route === undefined ? '' : routeNames[device.route]}`;
  const statusText = { online, connecting: 'Connecting…', offline: 'Not answering', stopped: 'Not started' }[device.status];
  const isConfirming = view.confirmingRemoval === device.deviceId;
  const product = device.productName ?? `product ${device.productKey}`;
  const readings = device.status === 'online' ? describeReadings(device.features, device.values) : '';
  return h(
    'li',
    { class: 'device' },
    h(
      'div',
      { class: 'device-main' },
      h('h3', {}, device.name),
      h('p', { class: 'meta' }, h('span', { class: `status ${device.status}` }, statusText), ` ${product}, ${device.deviceId}. In Matter: ${describeExposure(device)}.`),
      readings === '' ? null : h('p', { class: 'meta readings' }, `${readings}.`),
      routeLine(device),
      device.status !== 'online' && device.error ? h('p', { class: 'meta problem-text' }, device.error) : null,
      device.needsRestart
        ? h('p', { class: 'meta' }, h('strong', {}, 'Restart Matterbridge'), ' to apply the new options in Matter. Until then it keeps its current endpoints.')
        : null,
    ),
    isConfirming
      ? h(
          'div',
          { class: 'actions' },
          h('span', { class: 'meta' }, 'Remove it from Matter too?'),
          button('Remove', () => void removeDevice(device), 'danger'),
          button('Keep', () => {
            view.confirmingRemoval = '';
            render();
          }),
        )
      : h(
          'div',
          { class: 'actions' },
          // Either way the device is checked first, so the options offered are the ones it has today.
          button(device.status === 'online' ? 'Options' : 'Reconnect', () => startQueue([draftFromStored(device)]), 'quiet', view.setup?.account === undefined),
          button('Remove', () => {
            view.confirmingRemoval = device.deviceId;
            render();
          }),
        ),
  );
}

function accountPanel(): Child {
  const account = view.setup?.account;
  if (view.setup === undefined) return null;
  if (account === undefined) {
    return h(
      'section',
      { class: 'account' },
      h(
        'p',
        { class: 'notice problem', role: 'alert' },
        'No Tuya account is signed in. The devices below stay in Matter and are reached on your network alone, and new devices cannot be added, until you sign in.',
      ),
      button('Sign in', startSignIn, 'primary'),
    );
  }
  const signedIn =
    account.type === 'smartLife'
      ? `Signed in with the Smart Life app (User Code ${account.userCode}).`
      : `Signed in to the Tuya developer platform (project ${account.accessId}, data center ${dataCenterNames[account.dataCenter]}).`;
  const actions = view.confirmingSignOut
    ? [
        h('span', { class: 'meta' }, 'The devices stay in Matter, and keep working on your network.'),
        button('Sign out', () => void signOut(), 'danger'),
        button('Stay signed in', () => {
          view.confirmingSignOut = false;
          render();
        }),
      ]
    : [
        button(account.needsSignIn ? 'Sign in again' : 'Switch account', startSignIn, account.needsSignIn ? 'primary' : 'quiet'),
        button('Sign out', () => {
          view.confirmingSignOut = true;
          render();
        }),
      ];
  return h(
    'section',
    { class: 'account' },
    h('p', { class: 'meta' }, signedIn),
    account.needsSignIn
      ? h(
          'p',
          { class: 'notice problem', role: 'alert' },
          'The Tuya cloud no longer accepts this sign in. Sign in again to keep the devices reachable through the cloud and to add more.',
        )
      : null,
    h('div', { class: 'actions' }, ...actions),
  );
}

function discoveryNotice(): Child {
  const problem = view.setup?.discoveryError;
  if (problem === undefined) return null;
  return h(
    'p',
    { class: 'notice problem', role: 'alert' },
    `The plugin does not listen for devices on your network, so it reaches them through the Tuya cloud, or at the host given in their options: ${problem}`,
  );
}

/**
 * Draw the home screen: the account, and the stored devices with how each is doing
 *
 * @returns {Child[]} The screen.
 */
export function homeScreen(): Child[] {
  const devices = view.setup?.devices ?? [];
  const canAdd = view.setup?.account !== undefined && !view.setup.account.needsSignIn;
  return [
    h('header', {}, h('h1', {}, 'Tuya devices'), canAdd ? button('Add devices', () => void search(), 'primary') : null),
    notice(),
    accountPanel(),
    discoveryNotice(),
    devices.length === 0 && view.setup
      ? h('p', { class: 'empty' }, 'No device is set up yet. Add one to control it from Matter.')
      : h('ul', { class: 'devices' }, ...devices.map(deviceRow)),
    view.setup ? null : button('Try again', () => void loadState(), 'primary'),
  ];
}

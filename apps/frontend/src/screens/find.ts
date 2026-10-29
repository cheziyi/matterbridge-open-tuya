/**
 * @file apps/frontend/src/screens/find.ts
 * @description The Find step: the devices of the account, and why the plugin cannot control one.
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

import { goHome, search, startQueue } from '../actions.js';
import type { ListedDevice } from '../api.js';
import { button, notice, steps } from '../components.js';
import { type Child, h } from '../dom.js';
import { draftsFromDevices } from '../drafts.js';
import { render } from '../render.js';
import { view } from '../state.js';

// A device the catalog does not list by its product may still match by its data points, which the Connect step reads.
function isSelectable(device: ListedDevice): boolean {
  return !device.isConfigured && (device.support === 'supported' || device.support === 'unknownProduct');
}

function notesOf(device: ListedDevice): string[] {
  const notes: string[] = [];
  if (device.isConfigured) notes.push('Already set up.');
  if (device.support === 'unknownProduct') notes.push('The catalog does not list its product: the plugin checks its data points in the next step.');
  if (device.support === 'otherKind') notes.push('A kind of device the plugin does not control yet, such as a light: only switches, plugs and sensors for now.');
  if (device.support === 'gateway') notes.push('A gateway: the devices behind it are listed on their own.');
  if (device.support === 'gateway' || device.support === 'otherKind') return notes;
  if (!device.online) notes.push('The Tuya cloud says it is offline.');
  if (device.gatewayId !== undefined) notes.push('Behind a gateway.');
  if (device.lan !== undefined) notes.push(`Heard on your network at ${device.lan.host}.`);
  if (!device.hasLocalKey) notes.push('No local key from the cloud: reached through the cloud only.');
  return notes;
}

function deviceRow(device: ListedDevice): HTMLElement {
  const isAvailable = isSelectable(device);
  const id = `device-${device.deviceId}`;
  const checkbox = h('input', {
    type: 'checkbox',
    id,
    checked: isAvailable && view.selected.has(device.deviceId),
    disabled: !isAvailable,
    onchange: () => {
      if (checkbox.checked) view.selected.add(device.deviceId);
      else view.selected.delete(device.deviceId);
      render();
    },
  });
  return h(
    'li',
    { class: isAvailable ? 'found' : 'found unavailable' },
    h(
      'label',
      { for: id },
      checkbox,
      h(
        'span',
        {},
        h('strong', {}, device.name),
        h('span', { class: 'meta' }, ` ${device.deviceId}, product ${device.productKey}${device.category === '' ? '' : `, category ${device.category}`}`),
        ...notesOf(device).map((note) => h('span', { class: 'meta note' }, note)),
      ),
    ),
  );
}

export function findScreen(): Child[] {
  const chosen = view.devices.filter((device) => view.selected.has(device.deviceId) && isSelectable(device));
  const continueLabel = chosen.length === 1 ? 'Set up 1 device' : `Set up ${chosen.length} devices`;
  return [
    steps(),
    h('header', {}, h('h1', {}, 'Your Tuya devices')),
    notice(),
    view.devices.length > 0 ? h('ul', { class: 'found-list' }, ...view.devices.map(deviceRow)) : null,
    !view.isBusy && view.devices.length === 0 && view.error === ''
      ? h('p', { class: 'empty' }, 'Your Tuya account has no device yet. Add your devices in the Smart Life app, then read the list again.')
      : null,
    h(
      'div',
      { class: 'footer' },
      button('Read the list again', () => void search()),
      button('Cancel', goHome),
      button(continueLabel, () => startQueue(draftsFromDevices(chosen)), 'primary', chosen.length === 0),
    ),
  ];
}

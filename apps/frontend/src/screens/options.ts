/**
 * @file apps/frontend/src/screens/options.ts
 * @description The Options step: the name of the device in Matter, which of its features appear there, and how it is reached.
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

import { goHome, saveDraft } from '../actions.js';
import { type DeviceFeatures, type LanVersion, lanVersions, meterFeatureId } from '../api.js';
import { button, notice, steps, unitHeader, unitStrip } from '../components.js';
import { type Child, h } from '../dom.js';
import { mainFeatureId } from '../drafts.js';
import { describeReadings } from '../readings.js';
import { render } from '../render.js';
import { currentDraft, deviceLabel, type Draft } from '../state.js';

const sensorKindNames = {
  temperature: 'temperature sensor',
  humidity: 'humidity sensor',
  illuminance: 'light sensor',
  occupancy: 'motion sensor',
  contact: 'contact sensor',
  waterLeak: 'water leak detector',
} as const;

function toggle(id: string, isOn: boolean, title: string, text: string, onpick: (isOn: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', id, checked: isOn, onchange: () => onpick(input.checked) });
  return h('label', { class: 'choice', for: id }, input, h('span', {}, h('strong', {}, title), h('span', { class: 'meta' }, text)));
}

function radio<T extends string>(group: string, value: T, current: T, title: string, text: string, onpick: (value: T) => void): HTMLElement {
  const id = `${group}-${value}`;
  const input = h('input', { type: 'radio', name: group, id, checked: value === current, onchange: () => onpick(value) });
  return h('label', { class: 'choice', for: id }, input, h('span', {}, h('strong', {}, title), h('span', { class: 'meta' }, text)));
}

// A part of the main device has no name of its own in Matter: it is tagged with what it is.
function placement(draft: Draft, label: string): string {
  return draft.isComposed ? `It appears as a part of "${draft.name}", tagged "${label}".` : `It appears as "${draft.name} ${label}".`;
}

function setShown(list: string[], id: string, isShown: boolean): string[] {
  const without = list.filter((candidate) => candidate !== id);
  return isShown ? [...without, id] : without;
}

// Redrawn as it is typed, so that the texts that name the device follow. A redraw when the field is left instead would
// replace the button the click leaving it is on, and lose that click.
function nameSection(draft: Draft): HTMLElement {
  const input = h('input', { type: 'text', id: 'device-name', value: draft.name, maxLength: 32, autocomplete: 'off', spellcheck: false });
  input.addEventListener('input', (event) => {
    draft.name = input.value.trim();
    // A redraw in the middle of a composition, such as of Japanese text, would end it.
    if (!(event as InputEvent).isComposing) render();
  });
  const cloudName = draft.device.cloudName;
  const cloudText = cloudName === undefined ? '' : `Its name in the Smart Life app is "${cloudName}". `;
  return h(
    'section',
    {},
    h('h2', {}, h('label', { for: 'device-name' }, 'Name in Matter')),
    h(
      'p',
      { class: 'help' },
      `${cloudText}The name here is what your Matter apps show, up to 32 characters, and no two devices of this plugin share one. A new name in the Smart Life app does not change it.`,
    ),
    h('div', { class: 'inline-form' }, input),
  );
}

function featureSection(draft: Draft, features: DeviceFeatures): HTMLElement {
  const main = mainFeatureId(features);
  const mainFeature = [...features.outlets, ...features.sensors].find((feature) => feature.id === main);
  const items: Child[] = [];
  for (const outlet of features.outlets) {
    if (outlet.id === main) continue;
    items.push(
      toggle(`feature-${outlet.id}`, !draft.hiddenFeatures.includes(outlet.id), outlet.label, `An on/off outlet. ${placement(draft, outlet.label)}`, (isShown) => {
        draft.hiddenFeatures = setShown(draft.hiddenFeatures, outlet.id, !isShown);
        render();
      }),
    );
  }
  if (features.meter !== undefined && features.outlets.length > 0) {
    const measures = [features.meter.power && 'power', features.meter.voltage && 'voltage', features.meter.current && 'current', features.meter.energy && 'energy used'].filter(
      (name) => typeof name === 'string',
    );
    items.push(
      toggle(
        'feature-meter',
        !draft.hiddenFeatures.includes(meterFeatureId),
        'Meter',
        `The ${measures.join(', ')} of "${draft.name}", which few Matter apps show yet: Home Assistant does.`,
        (isShown) => {
          draft.hiddenFeatures = setShown(draft.hiddenFeatures, meterFeatureId, !isShown);
          render();
        },
      ),
    );
  }
  for (const sensor of features.sensors) {
    if (sensor.id === main) continue;
    items.push(
      toggle(`feature-${sensor.id}`, !draft.hiddenFeatures.includes(sensor.id), sensor.label, `A ${sensorKindNames[sensor.kind]}. ${placement(draft, sensor.label)}`, (isShown) => {
        draft.hiddenFeatures = setShown(draft.hiddenFeatures, sensor.id, !isShown);
        render();
      }),
    );
  }
  for (const setting of features.settingSwitches) {
    items.push(
      toggle(
        `feature-${setting.id}`,
        draft.addedFeatures.includes(setting.id),
        setting.label,
        `A switch for a setting of the device. ${placement(draft, setting.label)}`,
        (isShown) => {
          draft.addedFeatures = setShown(draft.addedFeatures, setting.id, isShown);
          render();
        },
      ),
    );
  }
  const mainText = mainFeature === undefined ? '' : `${mainFeature.label} is the device itself in Matter, and always appears there. `;
  return h(
    'section',
    {},
    h('h2', {}, 'What appears in Matter'),
    h('p', { class: 'help' }, items.length === 0 ? `${mainText}The device has nothing else to show.` : `${mainText}Choose what else appears with it.`),
    items.length === 0 ? null : h('div', { class: 'choices' }, ...items),
  );
}

function composedSection(draft: Draft): HTMLElement {
  return h(
    'section',
    {},
    h('h2', {}, 'One device or several'),
    h('p', { class: 'help' }, 'The other outlets, the sensors and the switches can be parts of the device in Matter, or devices of their own beside it.'),
    h(
      'div',
      { class: 'choices' },
      toggle(
        'composed',
        draft.isComposed,
        'Show it as one device',
        `Your Matter app has one device, "${draft.name}", and its parts move between rooms with it. A part has no name of its own in Matter, so an app may show the outlets as numbered outlets, and an app that shows no parts shows the device alone. Turned off, each is a device of its own with its own name, which your app puts in a room by itself.`,
        (isComposed) => {
          draft.isComposed = isComposed;
          render();
        },
      ),
    ),
  );
}

// The host and the version are read as they are typed, with no redraw: no other text on the page names them.
function hostFields(draft: Draft): HTMLElement {
  const host = h('input', { type: 'text', id: 'device-host', value: draft.host, placeholder: 'Found on your network', maxLength: 253, autocomplete: 'off', spellcheck: false });
  host.addEventListener('input', () => {
    draft.host = host.value.trim();
  });
  const version = h(
    'select',
    {
      id: 'device-version',
      onchange: () => {
        draft.version = version.value as LanVersion | '';
      },
    },
    h('option', { value: '', selected: draft.version === '' }, 'Pick the version'),
    ...lanVersions.map((value) => h('option', { value, selected: value === draft.version }, value)),
  );
  return h(
    'div',
    { class: 'field' },
    h('label', { for: 'device-host' }, 'Host'),
    h(
      'p',
      { class: 'help' },
      'Where the plugin does not hear the device on your network, such as on another subnet or in a Docker container without host networking, enter its IP address, ideally one your router keeps for it, and the protocol version it speaks, which the Smart Life app does not show: tinytuya or tuya-local tell it. Leave the host empty to find the device by the broadcasts it sends.',
    ),
    h('div', { class: 'inline-form' }, host),
    h('label', { for: 'device-version' }, 'Protocol version'),
    version,
  );
}

function connectionSection(draft: Draft): HTMLElement {
  const pick = (value: 'lan' | 'cloud'): void => {
    draft.isCloudOnly = value === 'cloud';
    render();
  };
  const current = draft.isCloudOnly ? 'cloud' : 'lan';
  const probeRoute = draft.probe?.route;
  let routeNote = '';
  if (probeRoute === 'lan') routeNote = ' It answered on your network just now.';
  else if (probeRoute === 'cloud') routeNote = ' It answered through the Tuya cloud just now: the plugin switches to your network once it hears the device there.';
  return h(
    'section',
    {},
    h('h2', { id: 'connection-title' }, 'Connection'),
    h('p', { class: 'help' }, `How the plugin reaches the device.${routeNote}`),
    h(
      'div',
      { 'class': 'choices', 'role': 'radiogroup', 'aria-labelledby': 'connection-title' },
      radio(
        'connection',
        'lan',
        current,
        'On your network first, through the Tuya cloud otherwise',
        'The plugin hears the device on your network by the broadcasts it sends, and follows it to a new IP address. It keeps working while the Tuya cloud or the internet is down.',
        pick,
      ),
      radio('connection', 'cloud', current, 'Through the Tuya cloud only', 'For a device that is not on the network of Matterbridge.', pick),
    ),
    draft.isCloudOnly ? null : hostFields(draft),
  );
}

/**
 * Draw the Options step: the name, the features, the layout and the connection of the device the run is on
 *
 * @returns {Child[]} The screen.
 */
export function optionsScreen(): Child[] {
  const draft = currentDraft();
  if (draft === undefined) return [notice()];
  const features = draft.features ?? { outlets: [], settingSwitches: [], sensors: [] };
  const readings = describeReadings(draft.features, draft.values);
  return [
    steps(),
    unitStrip(),
    unitHeader(draft, `Options for the ${deviceLabel(draft.device, draft.productName)}.`),
    readings === '' ? null : h('p', { class: 'meta readings' }, `It reports: ${readings}.`),
    nameSection(draft),
    featureSection(draft, features),
    composedSection(draft),
    connectionSection(draft),
    draft.isNew
      ? null
      : h(
          'p',
          { class: 'help' },
          'Changing what appears in Matter, or whether it is one device, takes effect at the next restart of Matterbridge, which this page and Matterbridge ask for. Until then the device keeps its current endpoints. The name and the connection change at once.',
        ),
    notice(),
    h(
      'div',
      { class: 'footer' },
      button('Cancel', goHome),
      button(draft.isNew ? `Add ${draft.name}` : 'Save options', () => void saveDraft(draft), 'primary'),
    ),
  ];
}

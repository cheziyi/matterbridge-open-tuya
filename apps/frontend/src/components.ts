/**
 * @file apps/frontend/src/components.ts
 * @description The pieces more than one screen of the setup page is made of.
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

import { type Child, h } from './dom.js';
import { currentDraft, type Draft, draftLabel, type ScreenName, view } from './state.js';

export function button(label: string, onclick: () => void, kind: 'primary' | 'quiet' | 'danger' = 'quiet', disabled = false): HTMLButtonElement {
  return h('button', { type: 'button', class: `button ${kind}`, onclick, disabled: disabled || view.isBusy }, label);
}

export function notice(): Child {
  if (view.isBusy) return h('p', { class: 'notice working', role: 'status' }, h('span', { class: 'spinner' }), view.busyText);
  if (view.error !== '') return h('p', { class: 'notice problem', role: 'alert' }, view.error);
  if (view.info !== '') return h('p', { class: 'notice', role: 'status' }, view.info);
  return null;
}

/**
 * The devices of this run, with the one the page is on marked: shown when a run sets up more than one, so that it is
 * plain which device the Connect and Options steps are about.
 */
export function unitStrip(): Child {
  const current = currentDraft();
  if (current === undefined || !current.isNew || view.handled.length + view.queue.length < 2) return null;
  const doing = view.screen === 'connect' ? 'Connecting' : 'Choosing options';
  return h(
    'ol',
    { 'class': 'units', 'aria-label': 'Devices in this setup' },
    ...view.handled.map((unit) =>
      h('li', { class: unit.isSaved ? 'done' : 'skipped' }, h('strong', {}, unit.label), h('span', { class: 'meta' }, unit.isSaved ? 'Added' : 'Skipped')),
    ),
    ...view.queue.map((draft, index) =>
      h(
        'li',
        { 'class': index === 0 ? 'current' : 'ahead', 'aria-current': index === 0 ? 'true' : undefined },
        h('strong', {}, draftLabel(draft)),
        h('span', { class: 'meta' }, index === 0 ? doing : 'Waiting'),
      ),
    ),
  );
}

/** The heading of a step that is about one device: the device first, then what the step does with it. */
export function unitHeader(draft: Draft, text: string): HTMLElement {
  return h('header', { class: 'unit-header' }, h('h1', {}, draftLabel(draft)), h('p', { class: 'meta' }, text));
}

export function steps(): Child {
  if (view.queue.length > 0 && !view.queue.some((draft) => draft.isNew)) return null;
  const names = ['Find', 'Connect', 'Options'];
  const screens: ScreenName[] = ['find', 'connect', 'options'];
  const current = screens.indexOf(view.screen);
  return h(
    'ol',
    { class: 'steps' },
    ...names.map((name, index) => {
      let state = 'ahead';
      if (index < current) state = 'done';
      else if (index === current) state = 'current';
      return h('li', { 'class': state, 'aria-current': index === current ? 'step' : undefined }, name);
    }),
  );
}

/**
 * @file apps/frontend/src/screens/done.ts
 * @description The end of a setup run: the devices it added.
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

import { goHome, reloadNote, restartNote } from '../actions.js';
import { button } from '../components.js';
import { type Child, h } from '../dom.js';
import { view } from '../state.js';

export function doneScreen(): Child[] {
  const names = view.saved;
  const needsRestart = (view.setup?.devices ?? []).some((device) => names.includes(device.name) && device.needsRestart);
  return [
    h('header', {}, h('h1', {}, names.length === 1 ? `${names[0]} is set up` : `${names.length} devices are set up`)),
    h('p', { class: 'lead' }, 'They now appear in the Matter apps paired with Matterbridge. If Matterbridge is not paired yet, pair it from its home page.'),
    needsRestart ? h('p', { class: 'help' }, h('strong', {}, restartNote)) : null,
    h('p', { class: 'help' }, reloadNote),
    h('div', { class: 'footer' }, button('Done', goHome, 'primary')),
  ];
}

/**
 * @file apps/frontend/src/screens/connect.ts
 * @description The Connect step: the plugin reads the device, on your network and through the Tuya cloud, and finds its catalog entry.
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

import { check, goHome, skipDraft, startSignIn } from '../actions.js';
import { button, notice, steps, unitHeader, unitStrip } from '../components.js';
import { type Child, h } from '../dom.js';
import { currentDraft, deviceLabel, type Draft, view } from '../state.js';

/** What stands in the way of the device, or what the page needs before it can go on: nothing while the check has no answer. */
function statusPanel(draft: Draft): Child {
  const status = draft.probe?.status;
  const label = draft.name === '' ? 'The device' : draft.name;
  const message = draft.probe?.message ?? 'unknown';
  if (status === 'signInRequired') {
    return h(
      'div',
      { class: 'field' },
      h('p', { class: 'notice problem', role: 'alert' }, 'The Tuya cloud no longer accepts the sign in of this plugin.'),
      button('Sign in again', startSignIn, 'primary'),
    );
  }
  if (status === 'unreachable') {
    return h(
      'p',
      { class: 'notice problem', role: 'alert' },
      `${label} did not answer. Check that it is plugged in and shows as online in the Smart Life app, then try again. ${message}`,
    );
  }
  if (status === 'unsupported') return h('p', { class: 'notice problem', role: 'alert' }, `The plugin cannot control ${label}: ${message}`);
  if (status === 'failed') return h('p', { class: 'notice problem', role: 'alert' }, `${label} answered with an error: ${message}`);
  return null;
}

export function connectScreen(): Child[] {
  const draft = currentDraft();
  if (draft === undefined) return [notice()];
  const canRetry = draft.probe?.status === 'unreachable' || draft.probe?.status === 'failed' || view.error !== '';
  const isOneOfMany = draft.isNew && view.queue.length > 1;
  return [
    steps(),
    unitStrip(),
    unitHeader(draft, `Connecting to the ${deviceLabel(draft.device, draft.productName)}.`),
    notice(),
    view.isBusy ? null : statusPanel(draft),
    h(
      'div',
      { class: 'footer' },
      canRetry ? button('Try again', () => void check(draft)) : null,
      button(isOneOfMany ? 'Skip this one' : 'Cancel', isOneOfMany ? skipDraft : goHome),
    ),
  ];
}

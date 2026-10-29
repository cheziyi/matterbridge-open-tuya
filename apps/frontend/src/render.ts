/**
 * @file apps/frontend/src/render.ts
 * @description Draws the screen the setup page is on. The screens are handed in by app.ts, so that they and the
 * actions can call for a redraw without this file depending on them.
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

import type { Child } from './dom.js';
import { currentDraft, type ScreenName, view } from './state.js';

export type Screens = Record<ScreenName, () => Child[]>;

let screens: Screens | undefined;

/** Tell the page what each screen draws. */
export function setScreens(all: Screens): void {
  screens = all;
}

export function render(): void {
  const root = document.getElementById('app');
  if (root === null || screens === undefined) return;
  // Keep what the user is typing when the same form redraws around it, and never carry it over to another form.
  const form = `${view.screen}:${currentDraft()?.device.deviceId ?? ''}`;
  const isSameForm = root.dataset.form === form;
  const active = document.activeElement;
  const activeId = active instanceof HTMLElement ? active.id : '';
  // Where the caret is in the field being typed in, so that a redraw while typing does not move it to the end.
  const caret =
    active instanceof HTMLInputElement && (active.type === 'text' || active.type === 'password') ? { start: active.selectionStart, end: active.selectionEnd } : undefined;
  const typed = new Map<string, string>();
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type=text], input[type=email], input[type=password]')) {
    if (input.id !== '') typed.set(input.id, input.value);
  }
  root.replaceChildren(...screens[view.screen]().filter((child): child is Node | string => child !== false && child !== null && child !== undefined));
  root.dataset.form = form;
  if (!isSameForm) return;
  for (const [id, value] of typed) {
    const input = document.getElementById(id);
    if (input instanceof HTMLInputElement) input.value = value;
  }
  if (activeId === '') return;
  const focused = document.getElementById(activeId);
  focused?.focus();
  if (caret !== undefined && focused instanceof HTMLInputElement) focused.setSelectionRange(caret.start, caret.end);
}

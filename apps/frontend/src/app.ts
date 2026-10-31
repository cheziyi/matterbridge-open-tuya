/**
 * @file apps/frontend/src/app.ts
 * @description The guided setup page of the Matterbridge Open Tuya plugin. Matterbridge serves it at
 * /plugins/matterbridge-open-tuya/ and it talks to the plugin through api/<path> below that address.
 * This file starts the page: the rest is in the files next to it.
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

import { loadState } from './actions.js';
import { h } from './dom.js';
import { render, setScreens } from './render.js';
import { connectScreen } from './screens/connect.js';
import { doneScreen } from './screens/done.js';
import { findScreen } from './screens/find.js';
import { homeScreen } from './screens/home.js';
import { optionsScreen } from './screens/options.js';
import { signInScreen } from './screens/signIn.js';
import { adoptHostTheme } from './theme.js';

setScreens({
  loading: () => [h('p', { class: 'notice working', role: 'status' }, h('span', { class: 'spinner' }), 'Loading…')],
  home: homeScreen,
  signIn: signInScreen,
  find: findScreen,
  connect: connectScreen,
  options: optionsScreen,
  done: doneScreen,
});

adoptHostTheme();
render();
void loadState();

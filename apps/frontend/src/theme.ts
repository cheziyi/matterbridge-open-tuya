/**
 * @file apps/frontend/src/theme.ts
 * @description Makes the setup page look like the Matterbridge page it is shown in.
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

/**
 * Take the colours and the font of the Matterbridge page this one is shown in
 *
 * @returns {void}
 */
export function adoptHostTheme(): void {
  try {
    if (window.parent === window) return;
    const host = getComputedStyle(window.parent.document.body);
    for (const name of ['--primary-color', '--div-bg-color', '--div-text-color', '--main-bg-color', '--main-label-color', '--div-border-color', '--main-light-color']) {
      const value = host.getPropertyValue(name).trim();
      if (value !== '') document.documentElement.style.setProperty(`--host${name.slice(1)}`, value);
    }
    document.documentElement.style.setProperty('--host-font', host.fontFamily);
  } catch {
    // Opened on its own or from another origin: the page keeps its own colours.
  }
}

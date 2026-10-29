/**
 * @file apps/frontend/src/qr.ts
 * @description Draws the QR code the Smart Life app scans to sign in.
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

import qrcode from 'qrcode-generator';

import { h } from './dom.js';

/**
 * Draw a text as a QR code.
 *
 * @param text The text, such as the one the plugin gives for the sign in.
 * @returns The QR code, as a scalable drawing in a light box.
 */
export function qrCodeElement(text: string): HTMLElement {
  // Type 0 picks the smallest QR code the text fits in, at the middle level of error correction.
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  // The drawing is made by the library from the text alone, never markup: innerHTML is safe for it.
  return h('div', { 'class': 'qr', 'role': 'img', 'aria-label': 'QR code to scan with the Smart Life app', 'html': code.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) });
}

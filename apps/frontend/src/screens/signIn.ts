/**
 * @file apps/frontend/src/screens/signIn.ts
 * @description The sign in: by QR code with the Smart Life app, or with a cloud project of the Tuya developer platform.
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

import { cancelQrCode, goHome, requestQrCode, signInDeveloper } from '../actions.js';
import { type DataCenter, dataCenterNames } from '../api.js';
import { button, notice } from '../components.js';
import { type Child, h } from '../dom.js';
import { qrCodeElement } from '../qr.js';
import { render } from '../render.js';
import { type SignIn, view } from '../state.js';

function methodChoice(method: SignIn['method'], title: string, text: string): HTMLElement {
  const id = `method-${method}`;
  const input = h('input', {
    type: 'radio',
    name: 'method',
    id,
    checked: view.signIn.method === method,
    onchange: () => {
      view.signIn.method = method;
      view.error = '';
      render();
    },
  });
  return h('label', { class: 'choice', for: id }, input, h('span', {}, h('strong', {}, title), h('span', { class: 'meta' }, text)));
}

function methodSection(): HTMLElement {
  return h(
    'section',
    {},
    h('h2', { id: 'method-title' }, 'How to sign in'),
    h(
      'div',
      { 'class': 'choices', 'role': 'radiogroup', 'aria-labelledby': 'method-title' },
      methodChoice('smartLife', 'With the Smart Life app (recommended)', 'Scan a QR code with the Smart Life or Tuya Smart app your devices are in. Nothing to set up first.'),
      methodChoice(
        'developer',
        'With a cloud project of the Tuya developer platform',
        'For a project you made on platform.tuya.com, with your app account linked to it. Its IoT Core trial has to be extended from time to time.',
      ),
    ),
  );
}

function userCodeForm(): Child[] {
  const input = h('input', { type: 'text', id: 'user-code', value: view.signIn.userCode, maxLength: 32, autocomplete: 'off', spellcheck: false });
  const submit = (): void => {
    const userCode = input.value.trim();
    if (userCode !== '') void requestQrCode(userCode);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  return [
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'user-code' }, 'User Code'),
      h('p', { class: 'help' }, 'In the Smart Life app, open Me, then the settings, then Account and Security: the User Code is listed there. It is case-sensitive.'),
      h('div', { class: 'inline-form' }, input),
    ),
    h('div', { class: 'footer' }, button('Cancel', goHome), button('Show the QR code', submit, 'primary')),
  ];
}

function qrPanel(qrCode: string): Child[] {
  return [
    h('p', { class: 'lead' }, 'In the Smart Life app, tap the scan icon at the top of the home tab, scan this code, and confirm the sign in in the app.'),
    qrCodeElement(qrCode),
    h('p', { class: 'notice working', role: 'status' }, h('span', { class: 'spinner' }), 'Waiting for the app to confirm…'),
    h('p', { class: 'help' }, 'The plugin signs in as Home Assistant does, so the app may name Home Assistant. The code stays valid for a few minutes.'),
    h(
      'div',
      { class: 'footer' },
      button('Cancel', () => void cancelQrCode()),
    ),
  ];
}

function smartLifeForm(): Child[] {
  const { login } = view;
  if (login.status === 'waiting' && login.qrCode !== undefined) return qrPanel(login.qrCode);
  const problem =
    login.status === 'expired'
      ? 'The QR code was not scanned in time. Show a new one to try again.'
      : login.status === 'failed'
        ? `The sign in did not work: ${login.message ?? 'unknown'}`
        : '';
  return [problem === '' ? null : h('p', { class: 'notice problem', role: 'alert' }, problem), ...userCodeForm()];
}

function developerForm(): Child[] {
  const accessId = h('input', { type: 'text', id: 'access-id', value: view.signIn.accessId, maxLength: 128, autocomplete: 'username', spellcheck: false });
  const accessSecret = h('input', { type: 'password', id: 'access-secret', maxLength: 128, autocomplete: 'current-password' });
  const dataCenter = h(
    'select',
    { id: 'data-center' },
    ...(Object.keys(dataCenterNames) as DataCenter[]).map((code) => h('option', { value: code, selected: code === view.signIn.dataCenter }, `${dataCenterNames[code]} (${code})`)),
  );
  const submit = (): void => {
    if (accessId.value.trim() === '' || accessSecret.value.trim() === '') return;
    void signInDeveloper(accessId.value.trim(), accessSecret.value.trim(), dataCenter.value as DataCenter);
  };
  accessSecret.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  return [
    h(
      'p',
      { class: 'help' },
      'The cloud project needs your Smart Life account linked to it, under Devices > Link App Account, and the IoT Core service. Its Access ID and Access Secret are on its overview page.',
    ),
    h('div', { class: 'field' }, h('label', { for: 'access-id' }, 'Access ID'), accessId),
    h('div', { class: 'field' }, h('label', { for: 'access-secret' }, 'Access Secret'), h('p', { class: 'help' }, 'It is kept in the configuration of the plugin.'), accessSecret),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'data-center' }, 'Data center'),
      h('p', { class: 'help' }, 'The data center of your app account, which the project lists under Devices.'),
      dataCenter,
    ),
    h('div', { class: 'footer' }, button('Cancel', goHome), button('Sign in', submit, 'primary')),
  ];
}

export function signInScreen(): Child[] {
  const isAgain = view.setup?.account !== undefined;
  const isWaiting = view.login.status === 'waiting';
  return [
    h('header', {}, h('h1', {}, isAgain ? 'Sign in to Tuya again' : 'Sign in to Tuya')),
    h(
      'p',
      { class: 'lead' },
      'The plugin lists your devices and gets the key each one encrypts its traffic with from the Tuya cloud, then reaches them on your network first. Your password is never asked for.',
    ),
    notice(),
    isWaiting ? null : methodSection(),
    ...(view.signIn.method === 'smartLife' ? smartLifeForm() : developerForm()),
  ];
}

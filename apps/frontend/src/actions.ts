/**
 * @file apps/frontend/src/actions.ts
 * @description What the buttons of the setup page do: each call to the plugin and where the page goes next.
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

import { api, type DataCenter, type QrLoginState, type SetupState, type StoredDevice } from './api.js';
import { fitExposure, pickExposure } from './drafts.js';
import { render } from './render.js';
import { currentDraft, type Draft, draftLabel, view } from './state.js';

/**
 * Run a call while the page shows that it is working.
 *
 * @param text What the page says meanwhile.
 * @param task The call.
 * @returns What the call returned.
 */
async function busy<T>(text: string, task: () => Promise<T>): Promise<T> {
  view.isBusy = true;
  view.busyText = text;
  view.error = '';
  view.info = '';
  render();
  try {
    return await task();
  } finally {
    view.isBusy = false;
    render();
  }
}

export async function loadState(): Promise<void> {
  const reply = await api('GET state');
  if (!reply.ok) {
    view.error = reply.error;
    view.screen = 'home';
    render();
    return;
  }
  setSetup(reply.state);
  // With no account and no device yet, the page goes straight to signing in, and with no device yet to finding them.
  if (reply.state.account === undefined && reply.state.devices.length === 0) {
    startSignIn();
    return;
  }
  if (reply.state.account !== undefined && reply.state.devices.length === 0 && !reply.state.account.needsSignIn) {
    await search();
    return;
  }
  view.screen = 'home';
  render();
  void syncState();
}

/**
 * Read the device list of the account again behind the page as it opens, so that what changed in the Smart Life app
 * since the last read, such as a name, shows without waiting for the next one. The page is redrawn only when the state
 * changed: a redraw for nothing could land between a press and its click, and lose the click.
 */
async function syncState(): Promise<void> {
  if (view.setup?.account === undefined) return;
  const reply = await api('POST sync');
  if (!reply.ok || JSON.stringify(reply.state) === JSON.stringify(view.setup)) return;
  setSetup(reply.state);
  render();
}

// The state is read again this long after it showed a device connecting.
const connectingRefreshInMs = 2000;
let connectingRefresh: number | undefined;

/** Take the state the plugin sent, and read it again in a moment while a device connects, so that its status settles without a reload. */
function setSetup(state: SetupState): void {
  view.setup = state;
  if (connectingRefresh !== undefined || !state.devices.some((device) => device.status === 'connecting')) return;
  connectingRefresh = window.setTimeout(() => {
    connectingRefresh = undefined;
    void refreshState().then(render);
  }, connectingRefreshInMs);
}

async function refreshState(): Promise<void> {
  const reply = await api('GET state');
  if (reply.ok) setSetup(reply.state);
}

export function goHome(): void {
  stopQrPolling();
  view.queue = [];
  view.saved = [];
  view.handled = [];
  view.error = '';
  view.info = '';
  view.screen = 'home';
  void refreshState().then(render);
  render();
}

export function startSignIn(): void {
  const account = view.setup?.account;
  if (account?.type === 'smartLife') view.signIn = { ...view.signIn, method: 'smartLife', userCode: account.userCode };
  if (account?.type === 'developer') view.signIn = { ...view.signIn, method: 'developer', accessId: account.accessId, dataCenter: account.dataCenter };
  view.login = { status: 'idle' };
  view.error = '';
  view.info = '';
  view.screen = 'signIn';
  render();
}

// The sign in by QR code is followed this often while the app has not confirmed it.
const qrPollIntervalInMs = 2000;
let qrPoll: number | undefined;

function stopQrPolling(): void {
  window.clearInterval(qrPoll);
  qrPoll = undefined;
}

export async function requestQrCode(userCode: string): Promise<void> {
  view.signIn.userCode = userCode;
  stopQrPolling();
  const reply = await busy('Asking the Smart Life cloud for a QR code…', async () => api('POST qr-code', { userCode }));
  if (!reply.ok) {
    view.error = reply.error;
    render();
    return;
  }
  view.login = reply.login;
  render();
  qrPoll = window.setInterval(() => void pollQrLogin(), qrPollIntervalInMs);
}

async function pollQrLogin(): Promise<void> {
  const reply = await api('GET qr-login');
  // A poll that failed is tried again at the next interval, unless the page left the sign in meanwhile.
  if (!reply.ok || view.screen !== 'signIn' || qrPoll === undefined) return;
  const { login } = reply;
  if (login.status === 'waiting') return;
  stopQrPolling();
  await takeLogin(login, reply.state);
}

async function takeLogin(login: QrLoginState, state: SetupState): Promise<void> {
  view.login = login;
  if (login.status !== 'signedIn') {
    render();
    return;
  }
  setSetup(state);
  await afterSignIn(state);
}

// The devices are what comes after an account, unless they are set up already.
async function afterSignIn(state: SetupState): Promise<void> {
  view.login = { status: 'idle' };
  if (state.devices.length === 0) await search();
  else goHome();
}

export async function cancelQrCode(): Promise<void> {
  stopQrPolling();
  view.login = { status: 'idle' };
  await api('DELETE qr-code');
  render();
}

export async function signInDeveloper(accessId: string, accessSecret: string, dataCenter: DataCenter): Promise<void> {
  view.signIn = { ...view.signIn, accessId, dataCenter };
  const reply = await busy('Signing in to the Tuya developer platform…', async () => api('POST developer-login', { accessId, accessSecret, dataCenter }));
  if (!reply.ok) {
    view.error = reply.error;
    render();
    return;
  }
  setSetup(reply.state);
  await afterSignIn(reply.state);
}

export async function signOut(): Promise<void> {
  const reply = await busy('Signing out…', async () => api('DELETE account'));
  view.confirmingSignOut = false;
  if (!reply.ok) view.error = reply.error;
  await refreshState();
  render();
}

export async function search(): Promise<void> {
  view.screen = 'find';
  const reply = await busy('Reading the devices of your Tuya account…', async () => api('POST devices'));
  if (!reply.ok) {
    view.error = `The devices could not be read: ${reply.error}`;
    render();
    return;
  }
  await refreshState();
  view.devices = reply.devices;
  for (const device of reply.devices) {
    if (!device.isConfigured && device.support === 'supported') view.selected.add(device.deviceId);
  }
  render();
}

export function startQueue(drafts: Draft[]): void {
  view.queue = drafts;
  view.saved = [];
  view.handled = [];
  void enterConnect();
}

async function enterConnect(): Promise<void> {
  const draft = currentDraft();
  if (draft === undefined) {
    view.screen = view.saved.length > 0 ? 'done' : 'home';
    await refreshState();
    render();
    return;
  }
  view.screen = 'connect';
  view.error = '';
  view.info = '';
  draft.probe = undefined;
  render();
  await check(draft);
}

export async function check(draft: Draft): Promise<void> {
  const reply = await busy(`Connecting to ${draftLabel(draft)} on your network, and through the Tuya cloud…`, async () => api('POST probe', { deviceId: draft.device.deviceId }));
  if (!reply.ok) {
    view.error = reply.error;
    render();
    return;
  }
  const { result } = reply;
  draft.probe = result;
  if (result.status === 'signInRequired') await refreshState();
  if (result.status === 'ready' && result.features !== undefined && result.catalogFile !== undefined) {
    draft.features = result.features;
    draft.values = result.values;
    draft.productName = result.productName;
    // A device the catalog now names by another entry has other features: the options are fitted to the ones it has.
    if (draft.catalogFile !== undefined && draft.catalogFile !== result.catalogFile) Object.assign(draft, { hiddenFeatures: [], addedFeatures: [] });
    draft.catalogFile = result.catalogFile;
    Object.assign(draft, fitExposure(pickExposure(draft), result.features));
    view.screen = 'options';
  }
  render();
}

export function skipDraft(): void {
  const skipped = view.queue.shift();
  if (skipped !== undefined) view.handled.push({ label: draftLabel(skipped), isSaved: false });
  void enterConnect();
}

export async function saveDraft(draft: Draft): Promise<void> {
  const name = draft.name.trim();
  const problem = checkName(draft, name) || checkHost(draft);
  if (problem !== '') {
    view.error = problem;
    render();
    return;
  }
  if (draft.catalogFile === undefined) return;
  const { device } = draft;
  // An empty host is left out: the plugin finds the device by its broadcasts. A device on the cloud alone needs none.
  const hasHost = !draft.isCloudOnly && draft.host !== '';
  const saved = {
    deviceId: device.deviceId,
    name,
    productKey: device.productKey,
    catalogFile: draft.catalogFile,
    ...fitExposure(pickExposure(draft), draft.features ?? { outlets: [], settingSwitches: [], sensors: [] }),
    host: hasHost ? draft.host : undefined,
    version: hasHost ? draft.version : undefined,
    isCloudOnly: draft.isCloudOnly || undefined,
  };
  const reply = await busy(`Saving ${name}…`, async () => api('POST device', { device: saved }));
  if (!reply.ok) {
    view.error = reply.error;
    render();
    return;
  }
  setSetup(reply.state);
  view.saved.push(name);
  view.handled.push({ label: name, isSaved: true });
  view.queue.shift();
  await enterConnect();
}

/** What is wrong with the name of a draft, or nothing: the plugin refuses a name another device has. */
function checkName(draft: Draft, name: string): string {
  if (name === '') return 'Give the device a name: it is the name it gets in Matter.';
  const isTaken = (view.setup?.devices ?? []).some((device) => device.name === name && device.deviceId !== draft.device.deviceId);
  return isTaken ? `"${name}" is already the name of another device. Pick a different one.` : '';
}

/** What is wrong with the host of a draft, or nothing: a host is given with the protocol version the device speaks there. */
function checkHost(draft: Draft): string {
  if (draft.isCloudOnly || draft.host === '') return '';
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(draft.host)) return `"${draft.host}" is not a host name or an IPv4 address.`;
  return draft.version === '' ? 'Pick the protocol version the device speaks at that host, or leave the host empty.' : '';
}

// Matterbridge does not tell its own page when a plugin adds or removes a device, so its device list waits for a reload.
export const reloadNote = "Matterbridge's own list of devices shows the change once you reload its page.";

/** A change of how a device appears in Matter waits for a restart, which the plugin asks Matterbridge for as well. */
export const restartNote = 'Restart Matterbridge to apply the new options in Matter: until then the device keeps its current endpoints.';

export async function removeDevice(device: StoredDevice): Promise<void> {
  const reply = await busy(`Removing ${device.name}…`, async () => api('DELETE device', undefined, `deviceId=${encodeURIComponent(device.deviceId)}`));
  view.confirmingRemoval = '';
  if (reply.ok) view.info = `${device.name} is removed. ${reloadNote}`;
  else view.error = reply.error;
  await refreshState();
  render();
}

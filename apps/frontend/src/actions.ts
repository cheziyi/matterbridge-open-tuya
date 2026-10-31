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
 * Run a call while the page shows that it is working
 *
 * @param {string} text What the page says meanwhile.
 * @param {() => Promise<T>} task The call.
 * @returns {Promise<T>} What the call returned.
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

/**
 * Load the page: read the state, and go to the screen it calls for
 *
 * @returns {Promise<void>} Resolves when the first screen is drawn.
 */
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
 * since the last read, such as a name, shows without waiting for the next one
 *
 * The page is redrawn only when the state changed: a redraw for nothing could land between a press and its click, and
 * lose the click.
 *
 * @returns {Promise<void>} Resolves when the list is read.
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

/**
 * Take the state the plugin sent, and read it again in a moment while a device connects, so that its status settles without a reload
 *
 * @param {SetupState} state The state.
 * @returns {void}
 */
function setSetup(state: SetupState): void {
  view.setup = state;
  if (connectingRefresh !== undefined || !state.devices.some((device) => device.status === 'connecting')) return;
  connectingRefresh = window.setTimeout(() => {
    connectingRefresh = undefined;
    void followConnecting();
  }, connectingRefreshInMs);
}

/**
 * Read the state again while a device connects, and redraw the home screen when it changed
 *
 * The home screen alone shows the devices. Another screen is left as it is, and a state that did not change redraws
 * nothing: a redraw for nothing could land between a press and its click, and lose the click.
 *
 * @returns {Promise<void>} Resolves when the state is read.
 */
async function followConnecting(): Promise<void> {
  const reply = await api('GET state');
  if (!reply.ok) return;
  const hasChanged = JSON.stringify(reply.state) !== JSON.stringify(view.setup);
  setSetup(reply.state);
  if (hasChanged && view.screen === 'home') render();
}

/**
 * Read the state again, without redrawing
 *
 * @returns {Promise<void>} Resolves when the state is read.
 */
async function refreshState(): Promise<void> {
  const reply = await api('GET state');
  if (reply.ok) setSetup(reply.state);
}

/**
 * Go to the home screen, leaving a run of the setup, and read the state again behind it
 *
 * @returns {void}
 */
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

/**
 * Go to the sign in, with the fields of the account signed in filled in
 *
 * @returns {void}
 */
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

/**
 * Stop following the sign in by QR code
 *
 * @returns {void}
 */
function stopQrPolling(): void {
  window.clearInterval(qrPoll);
  qrPoll = undefined;
}

/**
 * Ask the plugin for a QR code to sign in with the Smart Life app, show it, and follow the scan
 *
 * @param {string} userCode The User Code the app shows under Settings > Account and Security.
 * @returns {Promise<void>} Resolves when the QR code is shown, or the refusal.
 */
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

/**
 * Ask once how the sign in by QR code goes, and take the account once the scan is in
 *
 * @returns {Promise<void>} Resolves when the answer is taken.
 */
async function pollQrLogin(): Promise<void> {
  const reply = await api('GET qr-login');
  // A poll that failed is tried again at the next interval, unless the page left the sign in meanwhile.
  if (!reply.ok || view.screen !== 'signIn' || qrPoll === undefined) return;
  const { login } = reply;
  if (login.status === 'waiting') return;
  stopQrPolling();
  await takeLogin(login, reply.state);
}

/**
 * Take the outcome of the sign in by QR code
 *
 * @param {QrLoginState} login How the sign in went.
 * @param {SetupState} state The state, with the account once it is signed in.
 * @returns {Promise<void>} Resolves when the page shows it.
 */
async function takeLogin(login: QrLoginState, state: SetupState): Promise<void> {
  view.login = login;
  if (login.status !== 'signedIn') {
    render();
    return;
  }
  setSetup(state);
  await afterSignIn(state);
}

/**
 * Go on after a sign in: to the devices, unless they are set up already
 *
 * @param {SetupState} state The state, with the account signed in.
 * @returns {Promise<void>} Resolves when the next screen is drawn.
 */
async function afterSignIn(state: SetupState): Promise<void> {
  view.login = { status: 'idle' };
  if (state.devices.length === 0) await search();
  else goHome();
}

/**
 * Stop the sign in by QR code, here and in the plugin
 *
 * @returns {Promise<void>} Resolves when the plugin stopped waiting for the scan.
 */
export async function cancelQrCode(): Promise<void> {
  stopQrPolling();
  view.login = { status: 'idle' };
  await api('POST cancel-qr-code');
  render();
}

/**
 * Sign in with a cloud project of the Tuya developer platform
 *
 * @param {string} accessId The Access ID of the project.
 * @param {string} accessSecret The Access Secret of the project.
 * @param {DataCenter} dataCenter The data center of the project.
 * @returns {Promise<void>} Resolves when the account is signed in and the page went on, or shows the refusal.
 */
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

/**
 * Sign out of the account: the devices stay, on the LAN alone
 *
 * @returns {Promise<void>} Resolves when the page shows the outcome.
 */
export async function signOut(): Promise<void> {
  const reply = await busy('Signing out…', async () => api('POST sign-out'));
  view.confirmingSignOut = false;
  if (!reply.ok) view.error = reply.error;
  await refreshState();
  render();
}

/**
 * Go to the Find step, and list the devices of the account, with the ones the plugin can add picked
 *
 * @returns {Promise<void>} Resolves when the devices are shown, or the failure.
 */
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

/**
 * Start a run of the setup through the Connect and Options steps, one device after the other
 *
 * @param {Draft[]} drafts The devices to set up, in order.
 * @returns {void}
 */
export function startQueue(drafts: Draft[]): void {
  view.queue = drafts;
  view.saved = [];
  view.handled = [];
  void enterConnect();
}

/**
 * Go to the Connect step of the next device of the run, or to the end of the run
 *
 * @returns {Promise<void>} Resolves when the device is checked, or the end is shown.
 */
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

/**
 * Check a device through the plugin, and go to its options once it answers
 *
 * @param {Draft} draft The device.
 * @returns {Promise<void>} Resolves when the page shows the outcome.
 */
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
  if (result.status === 'ready' && result.features !== undefined && (result.catalogFile !== undefined || result.model !== undefined)) {
    draft.features = result.features;
    draft.values = result.values;
    draft.productName = result.productName;
    // A device now named by another entry has other features: the options are fitted to the ones it has.
    const hadEntry = draft.catalogFile !== undefined || draft.model !== undefined;
    if (hadEntry && (draft.catalogFile !== result.catalogFile || JSON.stringify(draft.model) !== JSON.stringify(result.model)))
      Object.assign(draft, { hiddenFeatures: [], addedFeatures: [] });
    draft.catalogFile = result.catalogFile;
    draft.model = result.model;
    Object.assign(draft, fitExposure(pickExposure(draft), result.features));
    view.screen = 'options';
  }
  render();
}

/**
 * Leave the device the run is on out, and go on to the next
 *
 * @returns {void}
 */
export function skipDraft(): void {
  const skipped = view.queue.shift();
  if (skipped !== undefined) view.handled.push({ label: draftLabel(skipped), isSaved: false });
  void enterConnect();
}

/**
 * Store a device with the options chosen, and go on to the next
 *
 * @param {Draft} draft The device, with its options.
 * @returns {Promise<void>} Resolves when the device is stored and the page went on, or shows what is wrong.
 */
export async function saveDraft(draft: Draft): Promise<void> {
  const name = draft.name.trim();
  const problem = checkName(draft, name) || checkHost(draft);
  if (problem !== '') {
    view.error = problem;
    render();
    return;
  }
  if (draft.catalogFile === undefined && draft.model === undefined) return;
  const { device } = draft;
  // An empty host is left out: the plugin finds the device by its broadcasts. A device on the cloud alone needs none.
  const hasHost = !draft.isCloudOnly && draft.host !== '';
  const saved = {
    deviceId: device.deviceId,
    name,
    productKey: device.productKey,
    catalogFile: draft.catalogFile,
    // A model names the controls by their codes in the device's category, which the plugin checks against the device list.
    model: draft.model,
    category: device.category,
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

/**
 * Tell what is wrong with the name of a draft: the plugin refuses a name another device has
 *
 * @param {Draft} draft The device.
 * @param {string} name Its name, trimmed.
 * @returns {string} What is wrong, or an empty text.
 */
function checkName(draft: Draft, name: string): string {
  if (name === '') return 'Give the device a name: it is the name it gets in Matter.';
  const isTaken = (view.setup?.devices ?? []).some((device) => device.name === name && device.deviceId !== draft.device.deviceId);
  return isTaken ? `"${name}" is already the name of another device. Pick a different one.` : '';
}

/**
 * Tell what is wrong with the host of a draft: a host is given with the protocol version the device speaks there
 *
 * @param {Draft} draft The device.
 * @returns {string} What is wrong, or an empty text.
 */
function checkHost(draft: Draft): string {
  if (draft.isCloudOnly || draft.host === '') return '';
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(draft.host)) return `"${draft.host}" is not a host name or an IPv4 address.`;
  return draft.version === '' ? 'Pick the protocol version the device speaks at that host, or leave the host empty.' : '';
}

// Matterbridge does not tell its own page when a plugin adds or removes a device, so its device list waits for a reload.
export const reloadNote = "Matterbridge's own list of devices shows the change once you reload its page.";

/** A change of how a device appears in Matter waits for a restart, which the plugin asks Matterbridge for as well. */
export const restartNote = 'Restart Matterbridge to apply the new options in Matter: until then the device keeps its current endpoints.';

/**
 * Remove a stored device from the plugin and from Matter
 *
 * @param {StoredDevice} device The device.
 * @returns {Promise<void>} Resolves when the page shows the outcome.
 */
export async function removeDevice(device: StoredDevice): Promise<void> {
  const reply = await busy(`Removing ${device.name}…`, async () => api('POST remove-device', { deviceId: device.deviceId }));
  view.confirmingRemoval = '';
  if (reply.ok) view.info = `${device.name} is removed. ${reloadNote}`;
  else view.error = reply.error;
  await refreshState();
  render();
}

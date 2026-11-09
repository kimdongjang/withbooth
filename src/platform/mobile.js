import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { db } from '../database/dexie';
import { apiTarget, httpsOrigin, validUpdate } from './mobileConfig';

export const isNative = Capacitor.isNativePlatform();
const sessionKeys = ['pos_admin_token', 'pos_admin_id', 'pos_selected_project_id'];
const legacyNativeKey = 'pos_native_session_v1';
// A login survives closed tabs, restarts and offline booth days; it lapses after 30 days unused.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Keep the existing sessionStorage consumers working, but restore sessions after tab close or process death.
const sessionKey = key => import.meta.env.MODE === 'localdb' ? `pos_local_dev:${key}` : key;
const persistedKey = sessionKey('pos_session_v2');
export const sessionStore = {
  getItem: key => sessionStorage.getItem(sessionKey(key)),
  setItem(key, value) { sessionStorage.setItem(sessionKey(key), value); persist(); },
  removeItem(key) { sessionStorage.removeItem(sessionKey(key)); persist(); },
};
function persist() {
  try {
    const values = Object.fromEntries(sessionKeys.map(key => [key, sessionStorage.getItem(sessionKey(key))]));
    // Logout removes the saved login for every tab; orders stay in IndexedDB.
    if (!values.pos_admin_token) localStorage.removeItem(persistedKey);
    else localStorage.setItem(persistedKey, JSON.stringify({ savedAt: Date.now(), values }));
    if (isNative) localStorage.removeItem(legacyNativeKey);
  } catch { /* Storage blocked or full: the current tab session still works. */ }
}
function restoreSession() {
  try {
    if (!sessionStorage.getItem(sessionKey('pos_admin_token'))) {
      const saved = JSON.parse(localStorage.getItem(persistedKey) || 'null');
      const legacy = !saved && isNative ? JSON.parse(localStorage.getItem(legacyNativeKey) || 'null') : null;
      const values = saved ? (Date.now() - Number(saved.savedAt) <= SESSION_TTL_MS ? saved.values : null) : legacy;
      if (values && typeof values.pos_admin_token === 'string') {
        for (const key of sessionKeys) if (typeof values[key] === 'string') sessionStorage.setItem(sessionKey(key), values[key]);
      }
    }
  } catch { /* A damaged session requires an online login; never clear the order queue. */ }
  // Opening the app counts as use and extends the 30 days (or drops an expired login).
  persist();
}
export function saveProjectList(adminId, projects) {
  if (isNative) localStorage.setItem(`pos_native_projects:${adminId}`, JSON.stringify(projects));
}
export function readProjectList(adminId) {
  if (!isNative) return null;
  try {
    const projects = JSON.parse(localStorage.getItem(`pos_native_projects:${adminId}`));
    return Array.isArray(projects) ? projects : null;
  } catch { return null; }
}

export async function initializeMobile() {
  restoreSession();
  if (!isNative) return;
  const origin = httpsOrigin(import.meta.env.VITE_MOBILE_API_ORIGIN);
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    if (typeof input === 'string' || input instanceof URL) {
      return originalFetch(apiTarget(String(input), origin, location.origin), options);
    }
    return originalFetch(input, options);
  };
  // Native bundles are managed atomically by the updater, not by a second SW cache.
  if ('serviceWorker' in navigator) {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  }
  await db.open();
  if (!navigator.locks) throw new Error('Android System WebView를 업데이트해주세요. 안전한 주문 동기화에 Web Locks가 필요합니다.');
  await NativeApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) window.dispatchEvent(new Event(navigator.onLine ? 'online' : 'offline'));
  });
}

let checking = false;
let ready;
export function mobileReady() {
  if (!isNative) return Promise.resolve(false);
  // StrictMode may mount the readiness gate twice; both mounts must await the same check.
  return ready ??= prepareMobile();
}

async function prepareMobile() {
  await CapacitorUpdater.notifyAppReady();
  let startup = true;
  let applying = false;
  const check = async () => {
    if (checking || !navigator.onLine) return false;
    checking = true;
    try {
      const origin = httpsOrigin(import.meta.env.VITE_MOBILE_API_ORIGIN);
      const { version: nativeVersion } = await NativeApp.getInfo();
      const response = await fetch(`${origin}/mobile-updates/latest.json`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) return;
      const manifest = await response.json();
      if (!validUpdate(manifest, origin, nativeVersion)) return;
      const { bundle } = await CapacitorUpdater.current();
      if (bundle.version === manifest.version) return;
      const { bundles } = await CapacitorUpdater.list();
      // Do not retry a failed/rolled-back release on every launch.
      const matching = bundles.filter(item => item.version === manifest.version);
      if (matching.some(item => item.status === 'error')) return false;
      const downloaded = matching.find(item => ['pending', 'success'].includes(item.status)) ||
        await CapacitorUpdater.download({ url: manifest.url, version: manifest.version, checksum: manifest.checksum });
      if (startup) {
        applying = true;
        // set() destroys this JS context. Never enter the sales screen during that switch.
        await CapacitorUpdater.set({ id: downloaded.id });
        return true;
      }
      await CapacitorUpdater.setMultiDelay({ delayConditions: [{ kind: 'kill' }] });
      await CapacitorUpdater.next({ id: downloaded.id });
      return false;
    } catch { /* Offline/update failure keeps the current bundle and every order intact. */ }
    finally { checking = false; }
  };
  let timer;
  try {
    // A slow/offline server must not prevent local sales. A late download is staged only.
    return await Promise.race([
      check(),
      new Promise(resolve => {
        timer = setTimeout(() => { if (!applying) resolve(false); }, 8000);
      }),
    ]);
  } finally {
    startup = false;
    clearTimeout(timer);
    window.addEventListener('online', check);
  }
}

import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ApiError } from '../api/client';
import { sharedApi } from '../auth/session';
import { VARIANT } from '../config';
import { secureStorage } from '../storage';
import { latestPosition, REPORT_EVERY_MS, shouldSendFromBackground } from './background-rules';

/**
 * The agent's location while the app is in the background: when they switch to their maps app or lock the
 * phone while online or on an errand. The phone runs this task; on Android it shows a notification while it
 * runs. It stops when the server says nothing needs sharing (offline, no errand) or the agent signs out.
 */
export const LOCATION_TASK = 'jiffo-agent-location';
const ONLINE_KEY = 'jiffo.agent.online';
const ASKED_KEY = 'jiffo.agent.background-asked';

/** Background location works only in the phone apps. */
export const backgroundSupported = Platform.OS !== 'web' && VARIANT === 'agent';

/** Kept for the task, which can run with the app closed: whether the agent is online. */
export const rememberOnline = (online: boolean) => secureStorage.set(ONLINE_KEY, online ? '1' : null);

let lastSent = 0;

if (backgroundSupported) {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const here = latestPosition(data?.locations);
    if (!here || !shouldSendFromBackground(AppState.currentState, Date.now(), lastSent)) return;
    lastSent = Date.now();
    try {
      const online = (await secureStorage.get(ONLINE_KEY)) === '1';
      const result = await sharedApi.put<{ sharingLocation: boolean }>('/v1/agent/presence', { online, ...here });
      if (!result.sharingLocation) await stopBackgroundLocation();
    } catch (e) {
      // Signed out: nothing to report for. Anything else (no signal) is tried again with the next position.
      if (e instanceof ApiError && e.status === 401) await stopBackgroundLocation();
    }
  });
}

/** Whether the agent has allowed location "all the time", which the task needs. */
export async function backgroundAllowed() {
  if (!backgroundSupported) return false;
  return (await Location.getBackgroundPermissionsAsync().catch(() => null))?.granted ?? false;
}

/** Whether to show the explanation before asking for background location: once, and only if it can be asked. */
export async function shouldExplainBackground() {
  if (!backgroundSupported || (await secureStorage.get(ASKED_KEY))) return false;
  const permission = await Location.getBackgroundPermissionsAsync().catch(() => null);
  return !!permission && !permission.granted && permission.canAskAgain;
}

/** Asks the phone for background location, after the agent read why. Asked once, whatever the answer. */
export async function askForBackground() {
  await secureStorage.set(ASKED_KEY, '1');
  return (await Location.requestBackgroundPermissionsAsync().catch(() => null))?.granted ?? false;
}

/** Remembers that the agent chose not to now, so they aren't asked every time they go online. */
export const skipBackground = () => secureStorage.set(ASKED_KEY, '1');

export async function startBackgroundLocation() {
  if (!(await backgroundAllowed())) return false;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) return true;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: REPORT_EVERY_MS,
    // Also when standing still, so an agent waiting in a queue stays visible.
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Jiffo Agent is sharing your location',
      notificationBody: "While you're online or on an errand. Go offline to stop.",
      notificationColor: '#0A7A4A',
    },
  });
  return true;
}

export async function stopBackgroundLocation() {
  if (!backgroundSupported) return;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
  }
}

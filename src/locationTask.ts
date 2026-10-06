import { PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { addFix } from './session';

export const LOCATION_TASK = 'runbutan-location';

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  for (const l of locations) {
    addFix({
      lat: l.coords.latitude,
      lon: l.coords.longitude,
      t: l.timestamp,
      accuracy: l.coords.accuracy,
      speed: l.coords.speed,
      altitude: l.coords.altitude,
      altitudeAccuracy: l.coords.altitudeAccuracy,
    });
  }
});

export const startTracking = async () => {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') throw new Error('Location permission denied');
  // Without these two the run silently records nothing (all fixes are too imprecise or never arrive).
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error('Location is switched off. Turn on Location (GPS) in your phone settings, then start again.');
  }
  if (fg.android?.accuracy === 'coarse') {
    throw new Error('RUNbutan only has approximate location. In Settings → Apps → RUNbutan → Permissions → Location, turn on "Use precise location".');
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') throw new Error('Allow location "All the time" so tracking survives screen-off');

  if (Platform.OS === 'android' && Platform.Version >= 33) {
    try {
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never); // not required to run, only to show the notification
    } catch {
      // ignore
    }
  }

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 0,
    foregroundService: {
      notificationTitle: 'RUNbutan',
      notificationBody: 'Tracking your run',
      notificationColor: '#FF4D2E',
    },
  });
};

export const stopTracking = async () => {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
};

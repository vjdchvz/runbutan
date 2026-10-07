import { Platform } from 'react-native';
import { setAudioModeAsync } from 'expo-audio';
import { abandonDuck as nativeAbandon, requestDuck as nativeRequest } from '../modules/runkit';

// Music ducking + background speech, per platform.
//  - Android: the RunKit native module asks for transient audio focus "may duck".
//  - iOS: the app's audio session. expo-speech speaks through the shared session, so a playback
//    session that stays active in the background keeps the coach talking with the screen locked,
//    and switching it to "duck others" while a line is spoken lowers the music.
const ios = Platform.OS === 'ios';

const setMode = (duck: boolean) =>
  setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    allowsRecording: false,
    interruptionMode: duck ? 'duckOthers' : 'mixWithOthers',
  }).catch(() => {});

export const initAudioSession = () => {
  if (ios) setMode(false);
};

export const requestDuck = () => {
  if (!ios) return nativeRequest();
  setMode(true);
  return true;
};

export const abandonDuck = () => {
  if (!ios) return nativeAbandon();
  setMode(false);
};

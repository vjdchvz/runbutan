import { createElement } from 'react';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/locationTask';
import App from './App';

registerRootComponent(() => createElement(SafeAreaProvider, null, createElement(App)));

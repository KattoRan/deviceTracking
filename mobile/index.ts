import { registerRootComponent } from 'expo';

if (__DEV__) {
  require('expo-dev-client');
}

// Side-effect import: đăng ký TaskManager task ở module level. PHẢI import
// trước App vì foreground service có thể load module này headless (khi OS
// pause activity nhưng service vẫn chạy) mà không qua React tree.
import './src/services/foregroundLocationService';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Vibration, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LockOverlay from './src/components/LockOverlay';
import { useDeviceInfo } from './src/hooks/useDeviceInfo';
import type { CommandDispatchEvent, RootStackParamList } from './src/models/types';
import {
  ackCommand,
  connectSocket,
  disconnectSocket,
  joinDeviceRoom,
  onCommand,
  sendCommandResult,
} from './src/services/socketService';
import HomeScreen from './src/screens/HomeScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import TrackingScreen from './src/screens/TrackingScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const { registrationStatus, storedData } = useDeviceInfo();
  const [lockMessage, setLockMessage] = useState<string | null>(null);

  // Keep the Socket.IO connection open for the lifetime of the app once
  // the device is registered — every screen that listens for `device_moved`
  // or `command` reuses the same singleton. Also join the device-scoped room
  // so this device receives commands addressed to it.
  useEffect(() => {
    if (registrationStatus !== 'registered' || !storedData?.deviceId) return;
    connectSocket();
    joinDeviceRoom(storedData.deviceId);
    return () => disconnectSocket();
  }, [registrationStatus, storedData?.deviceId]);

  // Global handlers — ring_alarm and lock_device must work regardless of
  // which screen the user is on, so they live here at the app root.
  // TrackingScreen handles request_location_now and toggle_tracking since
  // those depend on its local tracking state.
  useEffect(() => {
    if (registrationStatus !== 'registered') return;
    return onCommand((event: CommandDispatchEvent) => {
      if (event.command === 'ring_alarm') {
        ackCommand(event.commandId);
        const durationSec = Math.max(
          1,
          Math.min(60, Number(event.payload?.durationSec) || 10),
        );
        // Pattern: 500ms on / 200ms off, repeating for `durationSec`.
        // We cancel after the duration rather than relying on the pattern
        // length so the vibration stops exactly when we report success.
        Vibration.vibrate([0, 500, 200], true);
        setTimeout(() => {
          Vibration.cancel();
          sendCommandResult({ commandId: event.commandId, success: true });
        }, durationSec * 1000);
      } else if (event.command === 'lock_device') {
        ackCommand(event.commandId);
        const msg =
          typeof event.payload?.message === 'string'
            ? (event.payload.message as string)
            : 'Thiết bị đã bị khóa';
        setLockMessage(msg);
        sendCommandResult({ commandId: event.commandId, success: true });
      }
    });
  }, [registrationStatus]);

  if (registrationStatus === 'loading') {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#1976D2" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName={registrationStatus === 'registered' ? 'Home' : 'Register'}
          screenOptions={{
            headerStyle: { backgroundColor: '#1976D2' },
            headerTintColor: '#fff',
          }}
        >
          <Stack.Screen
            name="Register"
            component={RegisterScreen}
            options={{ title: 'Đăng ký thiết bị' }}
          />
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: 'Trang chủ', headerBackVisible: false }}
          />
          <Stack.Screen
            name="Tracking"
            component={TrackingScreen}
            options={{ title: 'Giám sát' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      <LockOverlay visible={lockMessage != null} message={lockMessage ?? undefined} />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
});

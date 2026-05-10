import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Vibration, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import BreachBellButton from './src/components/BreachBellButton';
import LockOverlay from './src/components/LockOverlay';
import ReturnedToast from './src/components/ReturnedToast';
import { GeofenceAlertProvider } from './src/contexts/GeofenceAlertContext';
import { useDeviceInfo } from './src/hooks/useDeviceInfo';
import type { CommandDispatchEvent, RootStackParamList } from './src/models/types';
import {
  ackCommand,
  connectSocket,
  disconnectSocket,
  joinDeviceRoom,
  onCommand,
  onDeviceDeleted,
  sendCommandResult,
} from './src/services/socketService';
import { disconnectMqtt } from './src/services/mqttService';
import RegisterScreen from './src/screens/RegisterScreen';
import TrackingScreen from './src/screens/TrackingScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const { registrationStatus, storedData, clearDeviceData } = useDeviceInfo();
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

  // Admin-triggered deletion: when the backend signals that this device
  // was removed from the management dashboard, wipe local registration so
  // the app falls back to the Register screen on next render.
  useEffect(() => {
    if (registrationStatus !== 'registered' || !storedData?.deviceId) return;
    const myId = storedData.deviceId;
    return onDeviceDeleted((event) => {
      if (event.deviceId !== myId) return;
      disconnectSocket();
      disconnectMqtt();
      void clearDeviceData();
      Alert.alert(
        'Thiết bị đã bị huỷ',
        'Quản trị viên đã huỷ đăng ký thiết bị này. Vui lòng đăng ký lại để tiếp tục sử dụng.',
      );
    });
  }, [registrationStatus, storedData?.deviceId, clearDeviceData]);

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
      <GeofenceAlertProvider deviceId={storedData?.deviceId ?? null}>
        <NavigationContainer>
          {/*
           * Auth-state pattern from react-navigation: only one screen is
           * registered at a time, so flipping `registrationStatus` rebuilds
           * the navigator and resets to the right screen automatically — no
           * manual `navigation.replace` needed after register or admin
           * deletion.
           */}
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: '#1976D2' },
              headerTintColor: '#fff',
              headerRight: () =>
                registrationStatus === 'registered' ? (
                  <BreachBellButton />
                ) : null,
            }}
          >
            {registrationStatus === 'registered' ? (
              <Stack.Screen
                name="Tracking"
                component={TrackingScreen}
                options={{ title: 'Giám sát', headerBackVisible: false }}
              />
            ) : (
              <Stack.Screen
                name="Register"
                component={RegisterScreen}
                options={{ title: 'Đăng ký thiết bị' }}
              />
            )}
          </Stack.Navigator>
        </NavigationContainer>
        <LockOverlay
          visible={lockMessage != null}
          message={lockMessage ?? undefined}
        />
        <ReturnedToast />
      </GeofenceAlertProvider>
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

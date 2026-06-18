import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Vibration, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import BreachBellButton from './src/components/BreachBellButton';
import LockOverlay from './src/components/LockOverlay';
import ReturnedToast from './src/components/ReturnedToast';
import { GeofenceAlertProvider } from './src/contexts/GeofenceAlertContext';
import { DeviceInfoProvider, useDeviceInfo } from './src/hooks/useDeviceInfo';
import type { CommandDispatchEvent, RootStackParamList } from './src/models/types';
import { ApiError, fetchLockStatus } from './src/services/apiService';
import {
  ackCommand,
  connectSocket,
  disconnectSocket,
  joinDeviceRoom,
  onCommand,
  onDeviceDeleted,
  onDeviceLockChanged,
  sendCommandResult,
} from './src/services/socketService';
import { disconnectMqtt } from './src/services/mqttService';
import PairScreen from './src/screens/PairScreen';
import TrackingScreen from './src/screens/TrackingScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  // The provider must sit above every consumer so that state set by
  // RegisterScreen (saveDeviceData) is visible to the auth-state branch
  // below in AppContent — without the wrapper, each useDeviceInfo() call
  // would own its own useState and updates wouldn't cross components.
  return (
    <DeviceInfoProvider>
      <AppContent />
    </DeviceInfoProvider>
  );
}

function AppContent() {
  const { registrationStatus, storedData, clearDeviceData } = useDeviceInfo();
  const [isLocked, setIsLocked] = useState(false);
  const [lockChecking, setLockChecking] = useState(true);
  const alarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Check lock status from server on app start. Cũng là cơ hội verify device
  // vẫn tồn tại — nếu admin huỷ ghép lúc app đóng, socket 'device_deleted'
  // không nhận được; ở đây bắt 404 → wipe local data → fall back Pair screen.
  useEffect(() => {
    if (registrationStatus !== 'registered' || !storedData?.deviceId) return;
    let cancelled = false;
    setLockChecking(true);
    fetchLockStatus(storedData.deviceId)
      .then((res) => {
        if (!cancelled) setIsLocked(res.locked);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          // Server xác nhận device không còn tồn tại → admin đã huỷ ghép.
          // Dọn local registration → AppContent re-render về Pair screen.
          disconnectSocket();
          disconnectMqtt();
          void clearDeviceData();
          Alert.alert(
            'Thiết bị đã bị huỷ',
            'Người quản lý đã huỷ ghép thiết bị này. Vui lòng ghép lại để tiếp tục sử dụng.',
          );
          return;
        }
        // Network/server unreachable — assume unlocked để app vẫn hoạt động
        // offline. Socket listener bên dưới sẽ lock realtime khi có mạng lại.
        setIsLocked(false);
      })
      .finally(() => {
        if (!cancelled) setLockChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [registrationStatus, storedData?.deviceId, clearDeviceData]);

  // Real-time lock/unlock via socket — admin toggles from dashboard.
  useEffect(() => {
    if (registrationStatus !== 'registered' || !storedData?.deviceId) return;
    const myId = storedData.deviceId;
    return onDeviceLockChanged((event) => {
      if (event.deviceId !== myId) return;
      setIsLocked(event.locked);
    });
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
        'Phụ huynh đã huỷ ghép thiết bị này. Vui lòng ghép lại để tiếp tục sử dụng.',
      );
    });
  }, [registrationStatus, storedData?.deviceId, clearDeviceData]);

  // Global handler — ring_alarm must work regardless of which screen the
  // user is on, so it lives here at the app root. TrackingScreen handles
  // request_location_now and toggle_tracking since those depend on its
  // local tracking state. lock_device is now managed via the persistent
  // is_locked field and the device_lock_changed socket event above.
  useEffect(() => {
    if (registrationStatus !== 'registered') return;
    return onCommand((event: CommandDispatchEvent) => {
      if (event.command === 'ring_alarm') {
        ackCommand(event.commandId);
        const durationSec = Math.max(
          1,
          Math.min(60, Number(event.payload?.durationSec) || 10),
        );

        // Hủy lần ring đang chạy nếu vẫn còn (cha mẹ bấm liên tiếp).
        if (alarmTimerRef.current) {
          clearTimeout(alarmTimerRef.current);
          alarmTimerRef.current = null;
        }

        Vibration.vibrate([0, 500, 200], true);

        alarmTimerRef.current = setTimeout(() => {
          Vibration.cancel();
          alarmTimerRef.current = null;
          sendCommandResult({ commandId: event.commandId, success: true });
        }, durationSec * 1000);
      }
    });
  }, [registrationStatus]);

  // Dọn timer khi unmount để không gửi sendCommandResult sau khi component
  // đã chết.
  useEffect(() => {
    return () => {
      if (alarmTimerRef.current) {
        clearTimeout(alarmTimerRef.current);
        alarmTimerRef.current = null;
      }
    };
  }, []);

  if (registrationStatus === 'loading' || (registrationStatus === 'registered' && lockChecking)) {
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
                name="Pair"
                component={PairScreen}
                options={{ title: 'Ghép thiết bị' }}
              />
            )}
          </Stack.Navigator>
        </NavigationContainer>
        <LockOverlay visible={isLocked} />
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

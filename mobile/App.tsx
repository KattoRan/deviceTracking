import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useDeviceInfo } from './src/hooks/useDeviceInfo';
import type { RootStackParamList } from './src/models/types';
import { connectSocket, disconnectSocket } from './src/services/socketService';
import HomeScreen from './src/screens/HomeScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import TrackingScreen from './src/screens/TrackingScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const { registrationStatus } = useDeviceInfo();

  // Keep the Socket.IO connection open for the lifetime of the app once
  // the device is registered — every screen that listens for
  // `device_moved` reuses the same singleton.
  useEffect(() => {
    if (registrationStatus !== 'registered') return;
    connectSocket();
    return () => disconnectSocket();
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

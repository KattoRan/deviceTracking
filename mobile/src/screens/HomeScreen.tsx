import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDeviceInfo } from '../hooks/useDeviceInfo';
import type { RootStackParamList } from '../models/types';
import { disconnectSocket } from '../services/socketService';
import { disconnectMqtt } from '../services/mqttService';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { storedData, clearDeviceData } = useDeviceInfo();

  const handleLogout = () => {
    Alert.alert('Xác nhận', 'Bạn có chắc muốn hủy đăng ký thiết bị?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Đồng ý',
        style: 'destructive',
        onPress: async () => {
          disconnectSocket();
          disconnectMqtt();
          await clearDeviceData();
          navigation.replace('Register');
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>Thiết bị đã đăng ký</Text>
        <InfoRow label="Họ tên" value={storedData?.fullName ?? '—'} />
        <InfoRow label="Email" value={storedData?.email ?? '—'} />
        <InfoRow label="Device ID" value={storedData?.deviceId ?? '—'} />
      </View>

      <TouchableOpacity
        style={[styles.button, styles.primary]}
        onPress={() => navigation.navigate('Tracking')}
        activeOpacity={0.7}
      >
        <Text style={styles.buttonText}>Bắt đầu theo dõi</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.danger]}
        onPress={handleLogout}
        activeOpacity={0.7}
      >
        <Text style={[styles.buttonText, styles.dangerText]}>Hủy đăng ký</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  content: { padding: 16 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 14 },
  row: { flexDirection: 'row', paddingVertical: 6 },
  rowLabel: { fontSize: 14, color: '#999', width: 100 },
  rowValue: { fontSize: 14, color: '#333', flex: 1, fontWeight: '500' },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primary: { backgroundColor: '#1976D2' },
  danger: { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#F44336' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  dangerText: { color: '#F44336' },
});

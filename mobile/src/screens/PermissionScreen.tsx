import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface PermissionScreenProps {
  /** Gọi khi user đã nhấn "Tiếp tục" sau khi grant đủ quyền bắt buộc. */
  onContinue: () => void;
}

type PermStatus = 'unknown' | 'granted' | 'denied';

interface PermItem {
  key: 'location' | 'phoneState' | 'activity' | 'notifications';
  emoji: string;
  title: string;
  description: string;
  required: boolean;
}

const PERM_ITEMS: PermItem[] = [
  {
    key: 'location',
    emoji: '📍',
    title: 'Vị trí (luôn cho phép)',
    description:
      'Cần để gửi GPS realtime cho người quản lý theo dõi vị trí thiết bị.',
    required: true,
  },
  {
    key: 'phoneState',
    emoji: '📡',
    title: 'Thông tin thiết bị',
    description:
      'Đọc thông tin trạm BTS (cell tower) để định vị tương đối khi không có GPS.',
    required: false,
  },
  {
    key: 'activity',
    emoji: '🚶',
    title: 'Nhận diện hoạt động',
    description:
      'Phân loại đứng yên / đi bộ / lái xe để tối ưu tần suất GPS, tiết kiệm pin.',
    required: false,
  },
  {
    key: 'notifications',
    emoji: '🔔',
    title: 'Thông báo',
    description:
      'Hiển thị notification "đang giám sát" và cảnh báo khi bị khoá.',
    required: false,
  },
];

export default function PermissionScreen({ onContinue }: PermissionScreenProps) {
  const [status, setStatus] = useState<Record<PermItem['key'], PermStatus>>({
    location: 'unknown',
    phoneState: 'unknown',
    activity: 'unknown',
    notifications: 'unknown',
  });
  const [requesting, setRequesting] = useState(false);

  // Check trạng thái hiện tại lúc mount để hiển thị đúng từ đầu.
  useEffect(() => {
    void refreshStatus();
  }, []);

  async function refreshStatus(): Promise<void> {
    const next = { ...status };

    try {
      const fg = await Location.getForegroundPermissionsAsync();
      const bg = await Location.getBackgroundPermissionsAsync();
      next.location =
        fg.status === 'granted' && bg.status === 'granted' ? 'granted' : 'denied';
    } catch {
      next.location = 'denied';
    }

    if (Platform.OS === 'android') {
      try {
        const ps = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
        );
        next.phoneState = ps ? 'granted' : 'denied';
      } catch {
        next.phoneState = 'denied';
      }

      if (Platform.Version >= 29) {
        try {
          const act = await PermissionsAndroid.check(
            'android.permission.ACTIVITY_RECOGNITION' as Parameters<
              typeof PermissionsAndroid.check
            >[0],
          );
          next.activity = act ? 'granted' : 'denied';
        } catch {
          next.activity = 'denied';
        }
      } else {
        next.activity = 'granted'; // không cần runtime trước Android 10
      }
    }

    if (Platform.OS === 'android' && Platform.Version >= 33) {
      try {
        const n = await PermissionsAndroid.check(
          'android.permission.POST_NOTIFICATIONS' as Parameters<
            typeof PermissionsAndroid.check
          >[0],
        );
        next.notifications = n ? 'granted' : 'denied';
      } catch {
        next.notifications = 'denied';
      }
    } else {
      next.notifications = 'granted'; // không cần runtime trước Android 13
    }

    setStatus(next);
  }

  async function requestAll(): Promise<void> {
    setRequesting(true);
    try {
      // Location foreground trước, sau đó background (Android 10+).
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status === 'granted') {
        await Location.requestBackgroundPermissionsAsync();
      }

      if (Platform.OS === 'android') {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
          {
            title: 'Quyền đọc thông tin thiết bị',
            message: 'Để đọc thông tin trạm BTS đang kết nối.',
            buttonPositive: 'Đồng ý',
            buttonNegative: 'Từ chối',
          },
        );

        if (Platform.Version >= 29) {
          await PermissionsAndroid.request(
            'android.permission.ACTIVITY_RECOGNITION' as Parameters<
              typeof PermissionsAndroid.request
            >[0],
            {
              title: 'Quyền nhận diện hoạt động',
              message:
                'Để phân loại đứng yên / đi bộ / lái xe, tối ưu pin và tần suất GPS.',
              buttonPositive: 'Đồng ý',
              buttonNegative: 'Từ chối',
            },
          );
        }
      }

      if (Platform.OS === 'android' && Platform.Version >= 33) {
        await PermissionsAndroid.request(
          'android.permission.POST_NOTIFICATIONS' as Parameters<
            typeof PermissionsAndroid.request
          >[0],
          {
            title: 'Quyền thông báo',
            message:
              'Để hiển thị thông báo "Đang giám sát vị trí" + cảnh báo khoá.',
            buttonPositive: 'Đồng ý',
            buttonNegative: 'Từ chối',
          },
        );
      }

      await refreshStatus();
    } finally {
      setRequesting(false);
    }
  }

  function handleContinue(): void {
    if (status.location !== 'granted') {
      Alert.alert(
        'Cần quyền vị trí',
        'Quyền vị trí là bắt buộc để app hoạt động. Vui lòng cấp quyền hoặc mở Cài đặt để bật thủ công.',
        [
          { text: 'Mở Cài đặt', onPress: () => Linking.openSettings() },
          { text: 'Để sau' },
        ],
      );
      return;
    }
    onContinue();
  }

  const requiredOk = status.location === 'granted';
  const allOk = PERM_ITEMS.every((p) => status[p.key] === 'granted');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Quyền truy cập</Text>
        <Text style={styles.subtitle}>
          Để app giám sát hoạt động đúng, vui lòng cấp các quyền sau. Bạn có
          thể từ chối các quyền không bắt buộc — app sẽ chạy với chức năng
          hạn chế.
        </Text>
      </View>

      <View style={styles.card}>
        {PERM_ITEMS.map((p) => (
          <View key={p.key} style={styles.row}>
            <Text style={styles.emoji}>{p.emoji}</Text>
            <View style={styles.rowBody}>
              <View style={styles.rowTitleLine}>
                <Text style={styles.rowTitle}>{p.title}</Text>
                {p.required && (
                  <Text style={styles.requiredTag}>Bắt buộc</Text>
                )}
              </View>
              <Text style={styles.rowDesc}>{p.description}</Text>
            </View>
            <StatusBadge state={status[p.key]} />
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.btn, requesting && styles.btnDisabled]}
        onPress={requestAll}
        disabled={requesting}
        activeOpacity={0.7}
      >
        {requesting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>
            {allOk ? 'Kiểm tra lại quyền' : 'Cấp quyền'}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.continueBtn,
          !requiredOk && styles.continueBtnDisabled,
        ]}
        onPress={handleContinue}
        disabled={!requiredOk}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.continueText,
            !requiredOk && styles.continueTextDisabled,
          ]}
        >
          Tiếp tục
        </Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        Nếu đã từ chối trước đó, vào Cài đặt → Ứng dụng → deviceTracking →
        Quyền để bật lại thủ công.
      </Text>
    </ScrollView>
  );
}

function StatusBadge({ state }: { state: PermStatus }) {
  if (state === 'granted') {
    return <Text style={styles.badgeGranted}>✓</Text>;
  }
  if (state === 'denied') {
    return <Text style={styles.badgeDenied}>✗</Text>;
  }
  return <Text style={styles.badgeUnknown}>?</Text>;
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#F5F5F5', flexGrow: 1 },
  header: { marginBottom: 20 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0D47A1',
    marginBottom: 8,
  },
  subtitle: { fontSize: 14, color: '#555', lineHeight: 20 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 8,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  emoji: { fontSize: 22, marginRight: 12, marginTop: 2 },
  rowBody: { flex: 1 },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#333' },
  requiredTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: '#F44336',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  rowDesc: { fontSize: 12, color: '#777', lineHeight: 18 },
  badgeGranted: {
    fontSize: 22,
    color: '#4CAF50',
    fontWeight: '700',
    marginLeft: 8,
  },
  badgeDenied: {
    fontSize: 22,
    color: '#F44336',
    fontWeight: '700',
    marginLeft: 8,
  },
  badgeUnknown: {
    fontSize: 22,
    color: '#999',
    marginLeft: 8,
  },
  btn: {
    backgroundColor: '#1976D2',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  btnDisabled: { backgroundColor: '#90CAF9' },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  continueBtn: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  continueBtnDisabled: { backgroundColor: '#E0E0E0' },
  continueText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  continueTextDisabled: { color: '#999' },
  hint: { fontSize: 12, color: '#888', textAlign: 'center', lineHeight: 18 },
});

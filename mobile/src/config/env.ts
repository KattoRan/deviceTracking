import Constants from 'expo-constants';

/**
 * Khi chạy Expo Go, request từ máy thật phải đi tới IP host của máy dev,
 * không thể là `localhost`. Ưu tiên EXPO_PUBLIC_API_HOST (env), fallback
 * về hostUri của Metro (Expo tự phát hiện), cuối cùng là localhost.
 */
function resolveHost(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_HOST;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.hostUri;
  if (hostUri) return hostUri.split(':')[0];

  return 'localhost';
}

export const SERVER_HOST = resolveHost();

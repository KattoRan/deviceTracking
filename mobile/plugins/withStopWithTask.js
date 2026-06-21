/**
 * Config plugin: ép `android:stopWithTask="true"` trên LocationTaskService
 * của expo-location.
 *
 * Mặc định expo-location đặt stopWithTask="false" → foreground service sống
 * sót khi user vuốt app khỏi recents. Dự án muốn ngược lại: vuốt app =
 * dừng giám sát. Plugin này chạy lúc prebuild nên giá trị không bị mất khi
 * regenerate thư mục android/.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const SERVICE_NAME = 'expo.modules.location.services.LocationTaskService';

module.exports = function withStopWithTask(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;

    const services = app.service ?? [];
    for (const svc of services) {
      if (svc.$?.['android:name'] === SERVICE_NAME) {
        svc.$['android:stopWithTask'] = 'true';
      }
    }
    return cfg;
  });
};

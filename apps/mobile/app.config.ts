import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Brand identity is centralized here and in src/theme.ts. Replace APP_NAME / bundle id / scheme via env
 * (EAS environment variables) — never hard-code owner-specific values in source.
 */
const APP_ENV = process.env.APP_ENV ?? 'development';
const NAME = process.env.APP_DISPLAY_NAME ?? (APP_ENV === 'production' ? 'بطاقتي' : `بطاقتي (${APP_ENV})`);
const BUNDLE_ID = process.env.IOS_BUNDLE_ID ?? 'com.example.bitaqati.dev'; // MUST be replaced by an identifier the owner controls
const SCHEME = process.env.APP_SCHEME ?? 'bitaqati';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME,
  slug: 'bitaqati',
  scheme: SCHEME,
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light', // Dark mode is not claimed for v1 (see docs/app-store-release.md).
  ios: {
    bundleIdentifier: BUNDLE_ID,
    buildNumber: process.env.IOS_BUILD_NUMBER ?? '1',
    supportsTablet: false, // iPhone only for v1; iPad not claimed until tested.
    config: { usesNonExemptEncryption: false }, // HTTPS/TLS only — confirm export-compliance answers before submission.
    infoPlist: {
      CFBundleDevelopmentRegion: 'ar',
      CFBundleLocalizations: ['ar', 'en'],
      NSCameraUsageDescription: 'تُستخدم الكاميرا لمسح رمز بطاقة العميل عند تسجيل الخصم، ولالتقاط صورتك الشخصية للبطاقة. Camera is used to scan customer cards and to take your card photo.',
      NSPhotoLibraryUsageDescription: 'لاختيار صورتك الشخصية للبطاقة. To choose your card photo.',
      NSLocationWhenInUseUsageDescription: 'لعرض المحلات القريبة منك فقط عند طلبك ذلك. Used only when you ask for nearby stores.',
      NSFaceIDUsageDescription: 'لقفل عرض بطاقتك إن فعّلت ذلك. To lock your card display if you enable it.',
      ITSAppUsesNonExemptEncryption: false,
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
      ],
      NSPrivacyTracking: false,
    },
  },
  android: {
    package: process.env.ANDROID_PACKAGE ?? 'com.example.bitaqati.dev',
    permissions: ['CAMERA'],
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },
  locales: { ar: './locales/ios-ar.json', en: './locales/ios-en.json' },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { image: './assets/icon.png', imageWidth: 180, backgroundColor: '#0F2A4A' }],
    'expo-secure-store',
    'expo-localization',
    ['expo-camera', { cameraPermission: 'تُستخدم الكاميرا لمسح رمز البطاقة ولالتقاط صورة البطاقة.', recordAudioAndroid: false }],
    ['expo-image-picker', { photosPermission: 'لاختيار صورتك الشخصية للبطاقة.', cameraPermission: 'لالتقاط صورتك الشخصية للبطاقة.', microphonePermission: false }],
    ['expo-location', { locationWhenInUsePermission: 'لعرض المحلات القريبة منك فقط عند طلبك ذلك.' }],
    ['expo-local-authentication', { faceIDPermission: 'لقفل عرض بطاقتك إن فعّلت ذلك.' }],
    ['expo-notifications', { color: '#13896A' }],
  ],
  extra: {
    appEnv: APP_ENV,
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000',
    supportsRTL: true,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
  experiments: { typedRoutes: false },
});

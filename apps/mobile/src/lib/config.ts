import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; appEnv?: string };

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? 'http://localhost:4000').replace(/\/$/, '');
export const APP_ENV = extra.appEnv ?? 'development';

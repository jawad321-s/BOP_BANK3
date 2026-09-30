import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from './api';

export type PushResult = 'granted' | 'denied' | 'unavailable';

/**
 * Asks for push permission in context (from Account → Notifications), never at launch and never as a
 * condition for using the card. Registers the Expo push token with the API.
 */
export async function enablePush(): Promise<PushResult> {
  if (!Device.isDevice) return 'unavailable';
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return 'denied';
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return 'unavailable';
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api('/v1/me/push-tokens', { method: 'POST', body: { token, platform: 'ios' } });
  return 'granted';
}

export async function pushStatus(): Promise<string> {
  return (await Notifications.getPermissionsAsync()).status;
}

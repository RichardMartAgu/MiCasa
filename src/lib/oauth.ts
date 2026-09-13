import * as AuthSession from 'expo-auth-session';
import { Platform } from 'react-native';

export interface OAuthCallbackParams {
  access_token?: string;
  refresh_token?: string;
  code?: string;
}

export function buildRedirectUri(): string {
  if (Platform.OS === 'web') {
    return getAuthRedirectOrigin();
  }
  return AuthSession.makeRedirectUri();
}

export function parseCallbackUrl(url: string): OAuthCallbackParams {
  const raw =
    url.indexOf('#') !== -1 ? (url.split('#')[1] ?? '') : (url.split('?')[1] ?? '');

  if (!raw) return {};

  const params = new URLSearchParams(raw);
  const result: OAuthCallbackParams = {};

  const accessToken = params.get('access_token');
  if (accessToken) result.access_token = accessToken;

  const refreshToken = params.get('refresh_token');
  if (refreshToken) result.refresh_token = refreshToken;

  const code = params.get('code');
  if (code) result.code = code;

  return result;
}

export function isWeb(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

export function getAuthRedirectOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}
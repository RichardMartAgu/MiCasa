import { parseCallbackUrl } from '@/lib/oauth';

describe('parseCallbackUrl', () => {
  it('extrae session del fragmento (implicit flow)', () => {
    const params = parseCallbackUrl(
      'micasa://auth-callback#access_token=atoken&refresh_token=rtoken&expires_in=3600',
    );
    expect(params).toEqual({ access_token: 'atoken', refresh_token: 'rtoken' });
  });

  it('extrae código de la query (PKCE)', () => {
    const params = parseCallbackUrl('micasa://auth-callback?code=auth_code_xyz&state=x');
    expect(params).toEqual({ code: 'auth_code_xyz' });
  });

  it('devuelve vacío sin credenciales', () => {
    expect(parseCallbackUrl('micasa://auth-callback')).toEqual({});
  });

  it('devuelve vacío con URL vacía', () => {
    expect(parseCallbackUrl('')).toEqual({});
  });

  it('ignora resto de fragmentos sin access_token', () => {
    const params = parseCallbackUrl('micasa://auth-callback#error=access_denied');
    expect(params).toEqual({});
  });
});
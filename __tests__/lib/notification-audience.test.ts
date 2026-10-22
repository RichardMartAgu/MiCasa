import { isAudienceVisible, isValidNotifyAudience } from '@/lib/notification-audience';

describe('isValidNotifyAudience', () => {
  it('solo acepta me y all', () => {
    expect(isValidNotifyAudience('me')).toBe(true);
    expect(isValidNotifyAudience('all')).toBe(true);
    expect(isValidNotifyAudience('casa')).toBe(false);
    expect(isValidNotifyAudience(null)).toBe(false);
  });
});

describe('isAudienceVisible', () => {
  it('sin viewer no concede audiencia (fail-closed)', () => {
    expect(isAudienceVisible({ user_id: 'u1', notify_audience: 'me' })).toBe(false);
    expect(isAudienceVisible({ user_id: 'u1', notify_audience: 'all' })).toBe(false);
  });

  it('me solo lo ve su autor', () => {
    const row = { user_id: 'u1', notify_audience: 'me' };
    expect(isAudienceVisible(row, 'u1')).toBe(true);
    expect(isAudienceVisible(row, 'u2')).toBe(false);
  });

  it('all lo ve cualquier miembro', () => {
    const row = { user_id: 'u1', notify_audience: 'all' };
    expect(isAudienceVisible(row, 'u2')).toBe(true);
  });

  it('un valor ilegible se repliega a me', () => {
    const row = { user_id: 'u1', notify_audience: 'casa' };
    expect(isAudienceVisible(row, 'u2')).toBe(false);
    expect(isAudienceVisible(row, 'u1')).toBe(true);
  });

  it('una fila legacy sin notify_audience se repliega a me', () => {
    const row = { user_id: 'u1' };
    expect(isAudienceVisible(row, 'u2')).toBe(false);
    expect(isAudienceVisible(row, 'u1')).toBe(true);
  });

  it('null y undefined cuentan como fila legacy', () => {
    expect(isAudienceVisible({ user_id: 'u1', notify_audience: null }, 'u2')).toBe(false);
    expect(isAudienceVisible({ user_id: 'u1', notify_audience: undefined }, 'u2')).toBe(false);
  });

  it('sin autor la audiencia me no es visible para nadie', () => {
    expect(isAudienceVisible({ user_id: null, notify_audience: 'me' }, 'u1')).toBe(false);
    expect(isAudienceVisible({}, 'u1')).toBe(false);
  });
});

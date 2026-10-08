import { WEB_HANDOFF_TTL_MS, WebHandoffStore } from './web-handoff.store';

describe('WebHandoffStore', () => {
  const user = { id: 'user-1', companyId: 'company-1', sessionVersion: 3 };
  let store: WebHandoffStore;

  beforeEach(() => {
    store = new WebHandoffStore();
  });

  it('issues an unguessable code that resolves to the account once', () => {
    const { code, expiresAt } = store.issue(user, 1_000);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime()).toBe(1_000 + WEB_HANDOFF_TTL_MS);
    expect(store.consume(code, 2_000)).toMatchObject({ userId: 'user-1', companyId: 'company-1', sessionVersion: 3 });
    expect(store.consume(code, 2_000)).toBeNull();
  });

  it('refuses a code once its minute is up, and spends it anyway', () => {
    const { code } = store.issue(user, 0);
    expect(store.consume(code, WEB_HANDOFF_TTL_MS)).toBeNull();
    expect(store.consume(code, 0)).toBeNull();
  });

  it('keeps one pending code per account: a new one replaces the old', () => {
    const first = store.issue(user, 0).code;
    const second = store.issue(user, 0).code;
    expect(first).not.toBe(second);
    expect(store.consume(first, 0)).toBeNull();
    expect(store.consume(second, 0)).not.toBeNull();
  });

  it('knows nothing of a code it never issued', () => {
    expect(store.consume('x'.repeat(43))).toBeNull();
  });
});

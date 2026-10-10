import { HttpException } from '@nestjs/common';
import { LIMITS, LOGIN_WINDOW_MS, LoginAttemptLimiter } from './login-attempt.limiter';

const MINUTE = 60_000;
const fail = (limiter: LoginAttemptLimiter, identifier: string, address: string | null, times: number, at = 0) => {
  for (let i = 0; i < times; i += 1) limiter.recordFailure(identifier, address, at + i);
};
const refusal = (limiter: LoginAttemptLimiter, identifier: string, address: string | null, now: number) => {
  try {
    limiter.assertAllowed(identifier, address, now);
    return null;
  } catch (error) {
    return error as HttpException;
  }
};

describe('LoginAttemptLimiter', () => {
  it('lets ordinary mistakes through: a few wrong passwords never block anyone', () => {
    const limiter = new LoginAttemptLimiter();
    fail(limiter, '+919876543210', '10.0.0.1', LIMITS.accountAndAddress - 1);
    expect(refusal(limiter, '+919876543210', '10.0.0.1', 100)).toBeNull();
  });

  it('refuses further guesses at one account from one address once the limit is hit — with the wait in the message', () => {
    const limiter = new LoginAttemptLimiter();
    fail(limiter, 'office@example.test', '10.0.0.1', LIMITS.accountAndAddress);
    const error = refusal(limiter, 'office@example.test', '10.0.0.1', 5 * MINUTE);
    expect(error?.getStatus()).toBe(429);
    expect(error?.message).toMatch(/wait 10 minutes/);
  });

  it('treats the same account written differently as one account', () => {
    const limiter = new LoginAttemptLimiter();
    fail(limiter, 'Office@Example.test ', '10.0.0.1', LIMITS.accountAndAddress);
    expect(refusal(limiter, 'office@example.test', '10.0.0.1', 1)?.getStatus()).toBe(429);
  });

  it('an attacker cannot lock the owner out from somewhere else', () => {
    const limiter = new LoginAttemptLimiter();
    fail(limiter, '+919876543210', '203.0.113.9', LIMITS.accountAndAddress);
    expect(refusal(limiter, '+919876543210', '203.0.113.9', 1)?.getStatus()).toBe(429);
    // The owner, on their own phone, signs in as normal.
    expect(refusal(limiter, '+919876543210', '10.0.0.1', 1)).toBeNull();
  });

  it('one address trying many accounts is stopped, but other accounts on a shared carrier address are not blocked early', () => {
    const limiter = new LoginAttemptLimiter();
    // Ten drivers behind one carrier address each mistype a couple of times: nobody is blocked.
    for (let driver = 0; driver < 10; driver += 1) fail(limiter, `+91700000000${driver}`, '100.64.0.1', 2);
    expect(refusal(limiter, '+917000000099', '100.64.0.1', 10)).toBeNull();

    // A scan across many accounts from that address is eventually refused.
    for (let guess = 0; guess < LIMITS.address; guess += 1) limiter.recordFailure(`victim-${guess}`, '100.64.0.1', 20 + guess);
    expect(refusal(limiter, '+917000000099', '100.64.0.1', 200)?.getStatus()).toBe(429);
  });

  it('stops a spread-out attack on one account from many addresses', () => {
    const limiter = new LoginAttemptLimiter();
    for (let address = 0; address < LIMITS.account; address += 1) limiter.recordFailure('ceo@example.test', `198.51.100.${address % 250}.${address}`, address);
    expect(refusal(limiter, 'ceo@example.test', '10.0.0.1', 1000)?.getStatus()).toBe(429);
  });

  it('forgets failures after the window, so the wait always ends', () => {
    const limiter = new LoginAttemptLimiter();
    fail(limiter, 'office@example.test', '10.0.0.1', LIMITS.accountAndAddress);
    expect(refusal(limiter, 'office@example.test', '10.0.0.1', LOGIN_WINDOW_MS - 1)?.getStatus()).toBe(429);
    expect(refusal(limiter, 'office@example.test', '10.0.0.1', LOGIN_WINDOW_MS + LIMITS.accountAndAddress)).toBeNull();
  });

  it('a successful sign-in clears that account\'s own count', () => {
    const limiter = new LoginAttemptLimiter();
    fail(limiter, 'office@example.test', '10.0.0.1', LIMITS.accountAndAddress - 1);
    limiter.recordSuccess('office@example.test', '10.0.0.1');
    fail(limiter, 'office@example.test', '10.0.0.1', LIMITS.accountAndAddress - 1, 1000);
    expect(refusal(limiter, 'office@example.test', '10.0.0.1', 2000)).toBeNull();
  });

  it('copes with an unknown address', () => {
    const limiter = new LoginAttemptLimiter();
    fail(limiter, 'office@example.test', null, LIMITS.accountAndAddress);
    expect(refusal(limiter, 'office@example.test', null, 1)?.getStatus()).toBe(429);
  });
});

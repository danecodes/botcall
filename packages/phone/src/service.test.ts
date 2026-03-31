import { describe, it, expect } from 'vitest';
import { extractCode } from './service.js';

describe('extractCode', () => {
  it('extracts a 6-digit code', () => {
    expect(extractCode('Your verification code is 847291')).toBe('847291');
  });

  it('extracts a 4-digit code', () => {
    expect(extractCode('Your PIN is 3842')).toBe('3842');
  });

  it('extracts a 5-digit code', () => {
    expect(extractCode('Enter code 59271 to continue')).toBe('59271');
  });

  it('extracts an 8-digit code', () => {
    expect(extractCode('One-time code: 48271039')).toBe('48271039');
  });

  it('handles "code:" prefix', () => {
    expect(extractCode('code: 123456')).toBe('123456');
  });

  it('handles "is XXXXXX" pattern', () => {
    expect(extractCode('Your code is 990012')).toBe('990012');
  });

  it('returns null when no code present', () => {
    expect(extractCode('Hello, welcome to our service!')).toBeNull();
  });

  // Known gap: some email clients split digits across elements e.g. <b>8</b><b>4</b>...
  // Simple regex works for plain-text SMS but not for rendered HTML email bodies.
  // Will be addressed when the email feature ships.
  it.todo('extracts codes from HTML email bodies with split digit elements');
});

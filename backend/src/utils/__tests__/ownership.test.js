import { isOwnedBy } from '../ownership.js';

const ME = { id: 'user_me', email: 'Ramya@Example.com' };

describe('isOwnedBy', () => {
  it('claims a submission filed by the account', () => {
    expect(isOwnedBy({ userId: 'user_me' }, ME)).toBe(true);
  });

  it('claims a submission carrying the login email, whoever filed it', () => {
    // The real case this exists for: filed through a shared account before the
    // submitter had a login of their own.
    expect(isOwnedBy({ userId: 'user_someone_else', submitterEmail: 'ramya@example.com' }, ME)).toBe(true);
  });

  it('does not disown a record the account filed under a different form email', () => {
    expect(isOwnedBy({ userId: 'user_me', submitterEmail: 'other@example.com' }, ME)).toBe(true);
  });

  it('rejects a submission belonging to someone else', () => {
    expect(isOwnedBy({ userId: 'user_other', submitterEmail: 'other@example.com' }, ME)).toBe(false);
  });

  it('matches email case-insensitively and ignores surrounding whitespace', () => {
    expect(isOwnedBy({ userId: 'x', submitterEmail: '  RAMYA@EXAMPLE.COM  ' }, ME)).toBe(true);
  });

  it('rejects public-projected records, which arrive stripped of both signals', () => {
    // toPublicSubmission() omits userId and submitterEmail; without them a
    // record must never be claimed, or every published row lands in the tab.
    expect(isOwnedBy({ id: 'submission_1' }, ME)).toBe(false);
  });

  it('does not let a user with no email claim records that have no email', () => {
    expect(isOwnedBy({ userId: 'user_other' }, { id: 'user_me', email: '' })).toBe(false);
  });

  it('does not match on an empty-string email at either end', () => {
    expect(isOwnedBy({ userId: 'user_other', submitterEmail: '' }, { id: 'user_me', email: '' })).toBe(false);
  });
});

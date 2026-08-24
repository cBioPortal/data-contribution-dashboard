/**
 * Does this submission belong to the given logged-in user?
 *
 * Two ways to own a record, both anchored on the logged-in identity:
 *   - the account filed it (userId), or
 *   - the login email is the address on the form.
 *
 * The login email is authoritative. A *different* address typed into the form
 * neither disowns a record the account filed, nor claims one for whoever owns
 * that address. This matters for submissions filed before the submitter had an
 * account — they carry someone else's userId but the submitter's email.
 *
 * Super users bypass this entirely; callers check the role separately.
 */
export function isOwnedBy(submission, user) {
  if (submission.userId === user.id) return true;
  const loginEmail = (user.email || '').toLowerCase().trim();
  const formEmail = (submission.submitterEmail || '').toLowerCase().trim();
  return !!loginEmail && loginEmail === formEmail;
}

export default { isOwnedBy };

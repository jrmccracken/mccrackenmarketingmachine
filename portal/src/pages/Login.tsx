import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { post } from '../api.ts';
import { useMe } from '../App.tsx';
import AuthLayout from './AuthLayout.tsx';

export default function Login() {
  const [params] = useSearchParams();
  const { me } = useMe();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  if (me?.user) return <Navigate to={params.get('next') || '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter your email address, for example name@company.co.uk'); return; }
    setBusy(true);
    try {
      const r = await post<{ message: string }>('/auth/login', { email: email.trim(), next: params.get('next') || '/' });
      setSent(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      <div className="auth-card">
        <div className="eyebrow">Client login</div>
        <h1>Sign in</h1>
        {params.get('signed_out') && !sent && <div className="alert success" role="status">You have signed out.</div>}
        {sent ? (
          <div role="status" aria-live="polite">
            <div className="alert success">{sent}</div>
            <p>Open the email on this device and select <strong>Sign in</strong>. If it hasn't arrived after a few minutes, check your junk folder.</p>
            <button type="button" className="btn" onClick={() => { setSent(''); }}>Use a different email address</button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <p>Enter the email address McCracken Marketing added to your workspace. We'll email you a one-time sign-in link. There is no password.</p>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={email}
                onChange={(e) => setEmail(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'email-error' : undefined} required />
              {error && <span className="error-text" id="email-error" role="alert">{error}</span>}
            </div>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}

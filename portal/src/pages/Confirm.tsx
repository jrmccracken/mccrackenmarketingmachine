import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { post } from '../api.ts';
import AuthLayout from './AuthLayout.tsx';

/**
 * The emailed link opens this page, and signing in needs a button press. Email security scanners
 * that open links automatically therefore can't use up the one-time link before the client does.
 */
export default function Confirm() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await post<{ next: string }>('/auth/confirm', { token, next: params.get('next') || '/' });
      window.location.replace(r.next || '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="auth-card">
        <div className="eyebrow">Client login</div>
        <h1>Finish signing in</h1>
        {!token ? (
          <><div className="alert error" role="alert">This sign-in link is incomplete. Please request a new one.</div><Link className="btn primary" to="/login">Request a new link</Link></>
        ) : error ? (
          <><div className="alert error" role="alert">{error}</div><Link className="btn primary" to="/login">Request a new link</Link></>
        ) : (
          <>
            <p>Select the button to sign in to the Marketing Control Centre on this device.</p>
            <button type="button" className="btn primary" onClick={confirm} disabled={busy} data-autofocus>{busy ? 'Signing in…' : 'Sign in'}</button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}

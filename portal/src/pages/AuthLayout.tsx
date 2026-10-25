import type { ReactNode } from 'react';
import { Logo } from '../App.tsx';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page dark">
      <header className="site-header">
        <div className="wrap">
          <a className="brand" href="https://mccrackenmarketing.co.uk/"><Logo /><span className="brand-text">Marketing Control Centre<small>McCracken Marketing</small></span></a>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="auth-foot">A private area for McCracken Marketing clients. <a href="https://mccrackenmarketing.co.uk/privacy-policy/">Privacy policy</a></footer>
    </div>
  );
}

import { useT } from '../../i18n';
import type { ReactNode } from 'react';

export function AuthLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <main className="auth-layout">
      <section className="auth-card">
        <header className="auth-heading">
          <div className="engine-brand">
            <img
              src="/favicon.svg"
              alt=""
              width={24}
              height={24}
              aria-hidden="true"
            />{' '}
            {t('app.brand')}
          </div>
          <h1>{title}</h1>
        </header>
        {children}
      </section>
    </main>
  );
}

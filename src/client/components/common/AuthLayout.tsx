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
            <span aria-hidden="true">{t('app.brandMark')}</span>{' '}
            {t('app.brand')}
          </div>
          <h1>{title}</h1>
        </header>
        {children}
      </section>
    </main>
  );
}

import { useT } from '../../i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { fetchGameBrand, type GameBrand } from '../../io/network';
import { version } from '../../../../package.json';

function useGameBrand() {
  const [brand, setBrand] = useState<GameBrand | null>(null);
  useEffect(() => {
    let live = true;
    void fetchGameBrand().then((b) => live && setBrand(b));
    return () => {
      live = false;
    };
  }, []);
  return brand;
}

export function AuthLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const t = useT();
  const brand = useGameBrand();
  return (
    <main className="auth-layout">
      <section className="auth-card">
        <header className="auth-heading">
          <div className="engine-brand">
            {brand && (
              <>
                <img src={brand.logo} alt="" aria-hidden="true" />
                <span>{brand.name}</span>
              </>
            )}
          </div>
          <h1>{title}</h1>
        </header>
        {children}
        <p className="engine-credit">{t('app.poweredBy', { version })}</p>
      </section>
    </main>
  );
}

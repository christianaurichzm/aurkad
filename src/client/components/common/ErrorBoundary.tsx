import { Component, type ReactNode } from 'react';
import { t } from '../../i18n';

/**
 * What the page shows when a render throws, where React would otherwise
 * unmount the whole root and leave it blank. Reloading is the way back, since
 * a screen that threw once throws again on the same state.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // A caught render error never reaches window.onerror, where the error
    // reporter listens.
    reportError(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="server-wait" role="alert">
        <p>{t('common.error')}</p>
        <button type="button" onClick={() => window.location.reload()}>
          {t('net.reload')}
        </button>
      </div>
    );
  }
}

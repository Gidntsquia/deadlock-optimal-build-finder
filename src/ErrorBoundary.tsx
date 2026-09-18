import { Component, type ErrorInfo, type ReactNode } from 'react';
import { log } from './log';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error('ui.error', { message: error.message, componentStack: info.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error" role="alert">
          Something went wrong rendering the page. Try reloading.
          <div style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

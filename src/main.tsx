import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';
import { Toaster } from './components/ui/sonner';
import './index.css';
import Shell from './Shell';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Shell />
      <Toaster />
    </ErrorBoundary>
  </StrictMode>,
);

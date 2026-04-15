import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { PtyBridgeProvider } from './context/PtyBridgeContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PtyBridgeProvider>
      <App />
    </PtyBridgeProvider>
  </StrictMode>
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import './index.css';
import App from './App';
import { startNativeHandoff } from './features/api/handoff';

// Inside the phone app: take the one-time sign-in code off the address before anything renders.
startNativeHandoff();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

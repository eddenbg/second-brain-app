
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './GlobalStyles.css';

// Capture beforeinstallprompt before React mounts to avoid missing the event
let _deferredInstallPrompt: Event | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  window.dispatchEvent(new CustomEvent('installpromptready'));
});
export const getInstallPrompt = () => _deferredInstallPrompt;
export const clearInstallPrompt = () => { _deferredInstallPrompt = null; };

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

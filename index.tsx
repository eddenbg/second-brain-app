
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './GlobalStyles.css';

// Capture beforeinstallprompt as early as possible (before React mounts)
// Stored on window to avoid circular module imports
(window as any).__installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as any).__installPrompt = e;
  window.dispatchEvent(new CustomEvent('installpromptready'));
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

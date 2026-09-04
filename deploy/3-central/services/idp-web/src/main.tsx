/* Entry de la SPA. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Fuentes autohospedadas (@fontsource): el bundle no depende de Google Fonts.
// La caja de un cliente puede vivir en una planta sin salida a internet — la
// tipografía del producto no puede depender de un CDN ajeno.
import '@fontsource/exo-2/300.css';
import '@fontsource/exo-2/400.css';
import '@fontsource/exo-2/500.css';
import '@fontsource/exo-2/600.css';
import '@fontsource/exo-2/800.css';
import '@fontsource/orbitron/800.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

import App from './App';
import { AuthProvider } from './auth/AuthProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);

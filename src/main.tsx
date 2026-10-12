import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
// The typefaces travel with the app (@fontsource packages, latin alphabet only): a till without internet cannot wait
// for Google Fonts to paint its screen. Imported here rather than from index.css, where the font files' relative
// addresses would not be rewritten.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-700.css'
import './index.css'

// Two separate entries, loaded on demand: the store's app, and the page a customer opens from the link of
// a receipt (/recibo/<code>). The customer's phone gets only that page — not the whole app, nor its
// sign-in and sync code, which a customer has no use for — and the app doesn't start there at all.
const App = lazy(() => import('./App.tsx'))
const PublicReceiptPage = lazy(() => import('./features/receipts/PublicReceiptPage.tsx'))

const isReceiptLink = window.location.pathname.startsWith('/recibo/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>{isReceiptLink ? <PublicReceiptPage /> : <App />}</Suspense>
  </StrictMode>,
)

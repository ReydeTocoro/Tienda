import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { AuthGate } from './features/auth/AuthGate'
import { startAppUpdate } from './app/appUpdate'

function App() {
  // Whoever has the app open — signed in or not — keeps it on the latest version.
  useEffect(() => startAppUpdate(), [])
  return (
    <AuthGate onSignedOut={() => void router.navigate('/', { replace: true })}>
      <RouterProvider router={router} />
    </AuthGate>
  )
}

export default App

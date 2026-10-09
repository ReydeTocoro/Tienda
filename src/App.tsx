import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { AuthGate } from './features/auth/AuthGate'

function App() {
  return (
    <AuthGate onSignedOut={() => void router.navigate('/', { replace: true })}>
      <RouterProvider router={router} />
    </AuthGate>
  )
}

export default App

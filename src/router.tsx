import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { VentaPage } from './features/pos/VentaPage'
import { InventarioPage } from './features/inventory/InventarioPage'
import { ClientesPage } from './features/customers/ClientesPage'
import { FiadosPage } from './features/fiados/FiadosPage'
import { HistorialPage } from './features/history/HistorialPage'
import { ReportePage } from './features/reports/ReportePage'

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <VentaPage /> },
      { path: '/inventario', element: <InventarioPage /> },
      { path: '/clientes', element: <ClientesPage /> },
      { path: '/fiados', element: <FiadosPage /> },
      { path: '/historial', element: <HistorialPage /> },
      { path: '/reporte', element: <ReportePage /> },
    ],
  },
])

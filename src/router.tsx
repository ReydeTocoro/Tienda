import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { VentaPage } from './features/pos/VentaPage'
import { InventarioPage } from './features/inventory/InventarioPage'
import { ClientesPage } from './features/customers/ClientesPage'
import { FiadosPage } from './features/fiados/FiadosPage'
import { HistorialPage } from './features/history/HistorialPage'
import { ReportePage } from './features/reports/ReportePage'
import { ConfiguracionPage } from './features/settings/ConfiguracionPage'
import { CajasPage } from './features/cash/CajasPage'
import { ProveedoresPage } from './features/suppliers/ProveedoresPage'
import { AdminGate } from './features/pin/AdminGate'

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <VentaPage /> },
      {
        path: '/inventario',
        element: (
          <AdminGate title="Acceso restringido" subtitle="Esta sección requiere PIN de administrador">
            <InventarioPage />
          </AdminGate>
        ),
      },
      { path: '/clientes', element: <ClientesPage /> },
      { path: '/fiados', element: <FiadosPage /> },
      { path: '/historial', element: <HistorialPage /> },
      {
        path: '/cajas',
        element: (
          <AdminGate title="Acceso restringido" subtitle="Las cajas requieren PIN de administrador">
            <CajasPage />
          </AdminGate>
        ),
      },
      {
        path: '/proveedores',
        element: (
          <AdminGate title="Acceso restringido" subtitle="Proveedores y compras requieren PIN de administrador">
            <ProveedoresPage />
          </AdminGate>
        ),
      },
      {
        path: '/reporte',
        element: (
          <AdminGate title="Acceso restringido" subtitle="Los reportes requieren PIN de administrador">
            <ReportePage />
          </AdminGate>
        ),
      },
      {
        path: '/configuracion',
        element: (
          <AdminGate title="Acceso restringido" subtitle="La configuración requiere PIN de administrador">
            <ConfiguracionPage />
          </AdminGate>
        ),
      },
    ],
  },
])

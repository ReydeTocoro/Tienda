import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { VentaPage } from './features/pos/VentaPage'
import { InventarioPage } from './features/inventory/InventarioPage'
import { ClientesPage } from './features/customers/ClientesPage'
import { FiadosPage } from './features/fiados/FiadosPage'
import { FacturasPage } from './features/invoices/FacturasPage'
import { ReportePage } from './features/reports/ReportePage'
import { ConfiguracionPage } from './features/settings/ConfiguracionPage'
import { CajasPage } from './features/cash/CajasPage'
import { ProveedoresPage } from './features/suppliers/ProveedoresPage'
import { ModuleGate } from './features/pin/ModuleGate'
import { NAV_ITEMS, gateText } from './app/navConfig'

/** A module behind the permission its nav item declares (Venta has none). */
function gated(to: string, page: ReactNode): ReactNode {
  const item = NAV_ITEMS.find((i) => i.to === to)
  if (!item?.need) return page
  const { title, subtitle } = gateText(item)
  return (
    <ModuleGate need={item.need} title={title} subtitle={subtitle}>
      {page}
    </ModuleGate>
  )
}

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <VentaPage /> },
      { path: '/inventario', element: gated('/inventario', <InventarioPage />) },
      { path: '/clientes', element: gated('/clientes', <ClientesPage />) },
      { path: '/fiados', element: gated('/fiados', <FiadosPage />) },
      { path: '/facturas', element: gated('/facturas', <FacturasPage />) },
      // The module used to be called Historial: keep old bookmarks and the installed app's shortcut working.
      { path: '/historial', element: <Navigate to="/facturas" replace /> },
      { path: '/cajas', element: gated('/cajas', <CajasPage />) },
      { path: '/proveedores', element: gated('/proveedores', <ProveedoresPage />) },
      { path: '/reporte', element: gated('/reporte', <ReportePage />) },
      { path: '/configuracion', element: gated('/configuracion', <ConfiguracionPage />) },
    ],
  },
])

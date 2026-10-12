// Tipos y formato compartidos por el PDF, la página pública y el panel de envío.
// Origen: src/utils/ticket.ts (tipos) y src/utils/format.ts (fmt / fmtCOP).

export interface ItemTicket {
  nombre: string;
  qty: number;
  precio: number;
}

/** Lo que se imprime, se manda por correo y se guarda para el enlace de WhatsApp. */
export interface DatosTicket {
  id?: string;
  numero?: string;
  fecha: string;                // ISO 8601
  cajero: string;
  cliente: string;              // 'Cliente general' si no hay
  nota?: string;
  metodo: string;               // 'efectivo' | 'transferencia' | 'tarjeta'
  items: ItemTicket[];
  total: number;
  subtotal?: number;
  descuento?: number;
  efectivo_recibido?: number;
  cambio?: number;
  tipo_documento?: string;      // 'factura' o cualquier otro valor (= recibo/ticket)
}

/** Datos del negocio que salen en el encabezado y pie del recibo. */
export interface ConfigNegocio {
  nombre?: string;
  nit?: string;
  ticket_header?: string;       // si existe, manda sobre `nombre`
  ticket_sub?: string;
  ticket_dir?: string;          // si existe, manda sobre `direccion`
  direccion?: string;
  ticket_tel?: string;          // si existe, manda sobre `telefono`
  telefono?: string;
  ticket_footer?: string;
  ticket_footer2?: string;
  /** Mensaje de despedida (en el original: ticket_footer o "¡Gracias por su compra!"). */
  ticket_mensaje?: string;
}

/** Lo que recibe la Cloud Function `enviarReciboCorreo` en `recibo`. */
export interface ReciboCorreo {
  negocio: { nombre: string; nit?: string; direccion?: string; telefono?: string; mensaje?: string };
  numero: string;
  fecha: string;
  cliente: string;              // vacío si es "Cliente general"
  metodo: string;
  items: ItemTicket[];
  subtotal?: number;
  descuento?: number;
  total: number;
  efectivo_recibido?: number;
  cambio?: number;
}

// ── Formato de dinero ───────────────────────────────────────────────────────
// Pesos colombianos, sin decimales: 4500 → "$4.500". Cambia el locale/moneda aquí
// si el otro proyecto es de otro país. La función del correo tiene su propia copia
// (_cop) con `style: "currency"`: manténganlas coherentes.
export function fmt(n: number): string {
  return new Intl.NumberFormat('es-CO').format(Math.round(n));
}

export function fmtCOP(n: number): string {
  return '$' + fmt(n);
}

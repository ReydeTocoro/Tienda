// ── Recibo en PDF ─────────────────────────────────────────────────────────
//
// COPIA de src/utils/reciboPdf.ts. Única diferencia: los tipos y fmtCOP se
// importan de ./tiposRecibo (en el original salen de ./ticket y ./format).
//
// El mismo recibo de 80 mm que se imprime, pero como archivo para mandarlo por
// correo o WhatsApp. Es texto real (no una captura): pesa unos 5 KB, se ve nítido
// y se puede seleccionar. Courier porque todo cae en columnas fijas, como en el
// papel térmico.
//
// jsPDF es pesado: se importa al usarlo, no al abrir la aplicación.
import { fmtCOP } from './tiposRecibo';
import type { DatosTicket, ConfigNegocio } from './tiposRecibo';

const ETIQUETA_PAGO: Record<string, string> = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta',
};

// Las fuentes estándar de PDF solo traen Latin-1 (tildes y ñ sí; viñetas, guiones
// largos o emojis no): lo que no cabe se cambia por algo equivalente para que no
// salga un carácter roto.
const limpio = (s: any) => String(s ?? '')
  .replace(/[–—−]/g, '-')
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/•/g, '*')
  // eslint-disable-next-line no-control-regex
  .replace(/[^ -~¡-ÿ]/g, '');

export async function generarReciboPdf(data: DatosTicket, negocio: ConfigNegocio = {}): Promise<Blob> {
  const { jsPDF } = await import('jspdf');

  const ANCHO = 80, M = 4;                    // mm: papel térmico y margen
  const UTIL = ANCHO - M * 2;
  const PT = 8;                               // Courier 8 pt = 42 columnas en 72 mm
  const LINEA = 3.6;                          // mm entre renglones

  // Se dibuja en dos pasadas: la primera solo mide el alto para crear la página
  // del tamaño justo (un rollo, sin hoja en blanco al final).
  const dibujar = (doc: any, medir: boolean) => {
    let y = M + 3;
    const txt = (t: string, x: number, opts: any = {}) => { if (!medir) doc.text(limpio(t), x, y, opts); };
    const fuente = (pt: number, bold = false) => { doc.setFont('courier', bold ? 'bold' : 'normal'); doc.setFontSize(pt); };
    const centrado = (t: string, pt = PT, bold = false) => {
      fuente(pt, bold);
      for (const l of doc.splitTextToSize(limpio(t), UTIL)) { txt(l, ANCHO / 2, { align: 'center' }); y += LINEA * pt / PT; }
    };
    const izqDer = (izq: string, der: string, pt = PT, bold = false) => {
      fuente(pt, bold);
      txt(izq, M); txt(der, ANCHO - M, { align: 'right' }); y += LINEA * pt / PT;
    };
    const raya = (dash = true) => {
      if (!medir) { doc.setLineWidth(0.15); doc.setLineDashPattern(dash ? [1, 0.8] : [], 0); doc.line(M, y - 1.2, ANCHO - M, y - 1.2); doc.setLineDashPattern([], 0); }
      y += 1.6;
    };

    const nombreNegocio = negocio.ticket_header || negocio.nombre || 'PANADERÍA';
    const dir = negocio.ticket_dir || negocio.direccion || '';
    const tel = negocio.ticket_tel || negocio.telefono || '';
    const f = new Date(data.fecha);
    const fecha = f.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' - ' + f.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const numero = data.numero || (data.id ? data.id.slice(-6).toUpperCase() : '');
    const docLabel = data.tipo_documento === 'factura' ? 'Factura de Venta' : 'Recibo';

    centrado(nombreNegocio, 12, true);
    if (negocio.ticket_sub) centrado(negocio.ticket_sub);
    if (dir) centrado(dir);
    if (tel) centrado('Tel: ' + tel);
    y += 1;
    centrado(fecha);
    centrado(docLabel + ' ' + numero, 9, true);
    raya();

    fuente(PT);
    izqDer('Cajero:', data.cajero || '-');
    izqDer('Cliente:', data.cliente || 'Cliente general');
    if (data.nota) for (const l of doc.splitTextToSize(limpio('Nota: ' + data.nota), UTIL)) { txt(l, M); y += LINEA; }
    raya(false);

    for (const i of data.items || []) {
      fuente(PT, true);
      for (const l of doc.splitTextToSize(limpio(i.nombre), UTIL)) { txt(l, M); y += LINEA; }
      izqDer(i.qty + ' x ' + fmtCOP(i.precio), fmtCOP(i.precio * i.qty), PT, true);
      y += 0.8;
    }
    raya();

    const desc = data.descuento || 0;
    if (desc > 0) {
      izqDer('Subtotal:', fmtCOP(data.subtotal || data.total));
      izqDer('Descuento:', '-' + fmtCOP(desc));
    }
    izqDer('Pago:', ETIQUETA_PAGO[data.metodo] || data.metodo);
    if (data.metodo === 'efectivo') {
      izqDer('Recibido:', fmtCOP(data.efectivo_recibido || 0));
      izqDer('Cambio:', fmtCOP(Math.max(0, data.cambio || 0)));
    }
    raya(false);
    izqDer('TOTAL', fmtCOP(data.total), 12, true);
    y += 1;
    raya();
    centrado(negocio.ticket_footer || '¡Gracias por su compra!');
    if (negocio.ticket_footer2) centrado(negocio.ticket_footer2);
    return y + M;
  };

  const probe = new jsPDF({ unit: 'mm', format: [ANCHO, 400] });
  const alto = dibujar(probe, true);
  const doc = new jsPDF({ unit: 'mm', format: [ANCHO, Math.max(60, alto)] });
  dibujar(doc, false);
  return doc.output('blob');
}

/** Base64 puro (sin el prefijo data:) — es lo que espera la función del correo. */
export function blobABase64(blob: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => mal(r.error);
    r.readAsDataURL(blob);
  });
}

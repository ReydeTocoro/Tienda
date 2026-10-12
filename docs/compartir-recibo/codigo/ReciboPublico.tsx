// Página pública del recibo: es el enlace que el cajero manda por WhatsApp
// (/recibo/<código>). La abre el CLIENTE, sin iniciar sesión. Lee el texto del
// recibo (colección recibos_compartidos) y arma el PDF aquí mismo, en su celular:
// en Firebase no se guarda ningún archivo.
//
// COPIA de src/pages/Recibo/ReciboPublico.tsx; solo cambian las rutas de import.
// Va SIN el layout del sistema y SIN modo oscuro (ver 02-adaptar.md).
//
// Se dibuja con JSX (no con HTML armado a mano) a propósito: el documento es
// legible por cualquiera que tenga el enlace y lo escribió el personal, así que
// React escapa todo en vez de fiarse de su contenido.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Loader2 } from 'lucide-react';
import { leerReciboCompartido } from './recibosCompartidos';
import { fmtCOP } from './tiposRecibo';
import { generarReciboPdf } from './reciboPdf';

const ETIQUETA_PAGO: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' };
const num = (v: any) => Number(v) || 0;

export function ReciboPublico() {
  const { id = '' } = useParams();
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'nada'>('cargando');
  const [recibo, setRecibo] = useState<{ datos: any; negocio: any } | null>(null);
  const [generando, setGenerando] = useState(false);
  const [falloPdf, setFalloPdf] = useState(false);

  useEffect(() => {
    document.title = 'Recibo';
    // Un recibo es privado: que los buscadores no lo indexen.
    const meta = document.createElement('meta');
    meta.name = 'robots'; meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

  useEffect(() => {
    let vivo = true;
    leerReciboCompartido(id).then((r) => {
      if (!vivo) return;
      if (r?.datos) { setRecibo(r); setEstado('ok'); document.title = 'Recibo ' + (r.datos.numero || ''); }
      else setEstado('nada');
    });
    return () => { vivo = false; };
  }, [id]);

  const descargar = async () => {
    if (!recibo) return;
    setGenerando(true); setFalloPdf(false);
    try {
      const blob = await generarReciboPdf(recibo.datos, recibo.negocio || {});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Recibo_' + String(recibo.datos.numero || 'compra').replace(/[^\w.-]/g, '_') + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setFalloPdf(true);
    } finally {
      setGenerando(false);
    }
  };

  if (estado === 'cargando') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#F5F1EA] text-[#7A6A58]">
        <Loader2 className="animate-spin mr-2" size={20} /> Cargando recibo…
      </div>
    );
  }

  if (estado === 'nada' || !recibo) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-2 bg-[#F5F1EA] px-6 text-center text-[#3B2A18]">
        <h1 className="text-lg font-bold">No encontramos este recibo</h1>
        <p className="text-sm text-[#7A6A58] max-w-xs">El enlace puede estar incompleto. Pídele a la panadería que te lo envíe de nuevo.</p>
      </div>
    );
  }

  const d = recibo.datos, n = recibo.negocio || {};
  const items: any[] = Array.isArray(d.items) ? d.items : [];
  const desc = num(d.descuento);
  const efectivo = d.metodo === 'efectivo';
  const fecha = new Date(d.fecha);
  const fechaTxt = isNaN(fecha.getTime()) ? '' : fecha.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' · ' + fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  const fila = (izq: string, der: string, fuerte = false) => (
    <div className={`flex justify-between gap-3 py-0.5 ${fuerte ? 'font-bold' : ''}`}><span>{izq}</span><span className="text-right">{der}</span></div>
  );

  return (
    <div className="min-h-[100dvh] bg-[#F5F1EA] px-4 py-6 flex flex-col items-center gap-4">
      <div className="w-full max-w-[340px] bg-white text-black shadow-md rounded-lg px-4 py-5 font-mono text-[12px] leading-snug">
        <div className="text-center border-b border-dashed border-black pb-2 mb-2">
          <div className="text-base font-bold">{String(n.ticket_header || n.nombre || 'PANADERÍA')}</div>
          {n.ticket_sub && <div className="text-[11px] text-[#555]">{String(n.ticket_sub)}</div>}
          {(n.ticket_dir || n.direccion) && <div className="text-[10px] text-[#555]">{String(n.ticket_dir || n.direccion)}</div>}
          {(n.ticket_tel || n.telefono) && <div className="text-[10px] text-[#555]">Tel: {String(n.ticket_tel || n.telefono)}</div>}
          <div className="text-[10px] text-[#666] mt-1">{fechaTxt}</div>
          <div className="text-[11px] font-bold mt-0.5">{d.tipo_documento === 'factura' ? 'Factura de Venta' : 'Recibo'} {String(d.numero || '')}</div>
        </div>

        <div className="text-[11px] mb-2">
          Cajero: <strong>{String(d.cajero || '-')}</strong><br />
          Cliente: <strong>{String(d.cliente || 'Cliente general')}</strong>
          {d.nota && <><br />Nota: <em>{String(d.nota)}</em></>}
        </div>

        <div className="border-t border-black border-b border-dashed py-2 mb-2">
          {items.map((i, k) => (
            <div key={k} className="mb-1.5 last:mb-0">
              <div className="font-bold break-words">{String(i.nombre)}</div>
              {fila(num(i.qty) + ' x ' + fmtCOP(num(i.precio)), fmtCOP(num(i.precio) * num(i.qty)), true)}
            </div>
          ))}
        </div>

        {desc > 0 && <>{fila('Subtotal:', fmtCOP(num(d.subtotal) || num(d.total)))}{fila('Descuento:', '−' + fmtCOP(desc))}</>}
        {fila('Pago:', ETIQUETA_PAGO[d.metodo] || String(d.metodo || ''))}
        {efectivo && <>{fila('Recibido:', fmtCOP(num(d.efectivo_recibido)))}{fila('Cambio:', fmtCOP(Math.max(0, num(d.cambio))))}</>}
        <div className="flex justify-between gap-3 border-t border-black mt-1 pt-1 text-[15px] font-bold">
          <span>TOTAL</span><span>{fmtCOP(num(d.total))}</span>
        </div>

        <div className="text-center text-[10px] border-t border-dashed border-black mt-3 pt-2">
          {String(n.ticket_footer || '¡Gracias por su compra!')}
          {n.ticket_footer2 && <><br />{String(n.ticket_footer2)}</>}
        </div>
      </div>

      <button
        onClick={descargar}
        disabled={generando}
        className="w-full max-w-[340px] flex items-center justify-center gap-2 rounded-xl bg-[#B45309] text-white font-semibold py-3 text-sm shadow-sm active:scale-[.98] transition disabled:opacity-70"
      >
        {generando ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
        {generando ? 'Preparando PDF…' : 'Descargar PDF'}
      </button>
      {falloPdf && <p className="text-sm text-red-700">No se pudo crear el PDF. Inténtalo de nuevo.</p>}
    </div>
  );
}

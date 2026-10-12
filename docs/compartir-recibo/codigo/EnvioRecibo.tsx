// Panel "enviar el recibo por correo / WhatsApp".
//
// EXTRACTO REORDENADO de src/pages/Caja/CajaTicket.tsx (openModalTicket →
// EnvioRecibo, enviarCorreo, abrirWhatsapp, textoRecibo, numeroWhatsapp). La lógica
// es la misma; lo que en el original venía del sistema (almacén de modales,
// toasts, lista de clientes, formato) aquí entra por props para que se pueda
// montar en cualquier pantalla de cualquier proyecto.
import { useEffect, useState } from 'react';
import { Send, ArrowLeft } from 'lucide-react';
import { blobABase64, generarReciboPdf } from './reciboPdf';
import { crearReciboCompartido, enviarReciboPorCorreo, mensajeErrorFuncion } from './recibosCompartidos';
import { fmtCOP } from './tiposRecibo';
import type { ConfigNegocio, DatosTicket } from './tiposRecibo';

const CORREO_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Celular colombiano de 10 dígitos (3xx…) → se le antepone el 57. Con indicativo o de
 * otro país (11 a 15 dígitos) se respeta tal cual. Fijos de 7 dígitos no sirven para
 * WhatsApp. ⚠ Cambia el prefijo/regla si el otro proyecto es de otro país.
 */
export function numeroWhatsapp(bruto: string): string | null {
  const d = bruto.replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 && d.startsWith('3')) return '57' + d;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

const nombreUtil = (n: any) => {
  const s = String(n || '').trim();
  return s && s.toLowerCase() !== 'cliente general' ? s : '';
};

export type Aviso = (texto: string, tipo: 'success' | 'error' | 'warning') => void;

interface Props {
  canal: 'correo' | 'whatsapp';
  datos: DatosTicket;
  negocio: ConfigNegocio;
  aviso: Aviso;
  /** Cierra el panel (después de enviar, o con la flecha de volver). */
  alVolver: () => void;
  /**
   * Opcional. Si el cliente del cobro existe en tu base de clientes, devuelve su
   * correo o celular para precargar el campo. En el original busca en la colección
   * `clientes` por nombre (campos `correo` y `celular`).
   */
  buscarContacto?: (canal: 'correo' | 'whatsapp', nombreCliente: string) => Promise<{ nombre: string; valor: string } | null>;
}

// ── Texto plano del recibo (respaldo de WhatsApp si no se pudo crear el enlace) ──
function textoRecibo(datos: DatosTicket, negocio: ConfigNegocio): string {
  const mensaje = negocio.ticket_mensaje || negocio.ticket_footer || '¡Gracias por su compra!';
  return [
    '*' + (negocio.nombre || '') + '*',
    'Recibo ' + (datos.numero || ''),
    new Date(datos.fecha).toLocaleString('es-CO'),
    '',
    ...datos.items.map(i => '• ' + i.qty + ' x ' + i.nombre + ' — ' + fmtCOP(i.qty * i.precio)),
    '',
    ...((datos.descuento || 0) > 0 ? ['Descuento: -' + fmtCOP(datos.descuento || 0)] : []),
    '*TOTAL: ' + fmtCOP(datos.total || 0) + '*',
    '',
    mensaje,
  ].join('\n');
}

// Correo: lo arma y lo manda una Cloud Function (con el Gmail del negocio). El PDF se
// crea aquí y viaja adjunto; si no se pudo armar (navegador raro, sin memoria...) se
// sigue sin él, porque el cuerpo del correo ya lleva el recibo.
async function enviarCorreo(destino: string, datos: DatosTicket, negocio: ConfigNegocio) {
  const pdf = await generarReciboPdf(datos, negocio).catch(() => null);
  await enviarReciboPorCorreo({
    to: destino,
    pdfBase64: pdf ? await blobABase64(pdf) : undefined,
    recibo: {
      negocio: {
        nombre: negocio.nombre || '', nit: negocio.nit, direccion: negocio.direccion,
        telefono: negocio.telefono, mensaje: negocio.ticket_mensaje || negocio.ticket_footer,
      },
      numero: datos.numero || '',
      fecha: datos.fecha,
      cliente: nombreUtil(datos.cliente),
      metodo: datos.metodo,
      items: datos.items,
      subtotal: datos.subtotal,
      descuento: datos.descuento,
      total: datos.total || 0,
      efectivo_recibido: datos.efectivo_recibido,
      cambio: Math.max(0, datos.cambio || 0),
    },
  });
}

// WhatsApp no deja adjuntar un archivo desde un enlace (wa.me solo lleva texto), así
// que se guarda el TEXTO del recibo en Firestore y el mensaje lleva su enlace: ahí el
// cliente ve el recibo y descarga el PDF, que se arma en su celular. Si algo falla se
// manda el recibo en texto, que siempre funciona.
// ⚠ La pestaña se abre ANTES de crear el enlace, dentro del clic: si se abriera
// después de esperar, el navegador la bloquearía como ventana emergente.
async function abrirWhatsapp(numero: string, datos: DatosTicket, negocio: ConfigNegocio, aviso: Aviso) {
  const w = window.open('', '_blank');
  if (!w) { aviso('Habilita las ventanas emergentes para abrir WhatsApp.', 'warning'); return; }
  const ir = (texto: string) => { w.location.href = 'https://wa.me/' + numero + '?text=' + encodeURIComponent(texto); };

  let enlace = '';
  try {
    enlace = await crearReciboCompartido({ datos, negocio });
  } catch (e: any) {
    aviso('No se pudo crear el enlace del recibo (' + mensajeErrorFuncion(e) + '). Se envía el recibo en texto.', 'warning');
  }
  const mensaje = negocio.ticket_mensaje || negocio.ticket_footer || '¡Gracias por su compra!';
  ir(enlace
    ? [
        '*' + (negocio.nombre || '') + '*',
        'Recibo ' + (datos.numero || '') + ' · Total: ' + fmtCOP(datos.total || 0),
        '',
        'Ver y descargar tu recibo (PDF):',
        enlace,
        '',
        mensaje,
      ].join('\n')
    : textoRecibo(datos, negocio));
}

export function EnvioRecibo({ canal, datos, negocio, aviso, alVolver, buscarContacto }: Props) {
  const esCorreo = canal === 'correo';
  const [valor, setValor] = useState('');
  const [deCliente, setDeCliente] = useState('');   // nombre del cliente de quien salió el dato
  const [enviando, setEnviando] = useState(false);

  // Si el cliente del cobro está en la lista de clientes, se precarga su
  // correo/celular; siempre se puede escribir otro.
  useEffect(() => {
    const nombreCliente = nombreUtil(datos.cliente);
    if (!nombreCliente || !buscarContacto) return;
    let vivo = true;
    buscarContacto(canal, nombreCliente).then((c) => {
      if (vivo && c?.valor) { setValor(String(c.valor)); setDeCliente(c.nombre); }
    }).catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enviar = async () => {
    if (esCorreo) {
      const destino = valor.trim();
      if (!CORREO_OK.test(destino)) return aviso('Ese correo no parece válido.', 'error');
      setEnviando(true);
      try {
        await enviarCorreo(destino, datos, negocio);
        aviso('Recibo enviado a ' + destino, 'success');
        alVolver();
      } catch (e: any) {
        aviso(mensajeErrorFuncion(e), 'error');
        setEnviando(false);
      }
      return;
    }
    const numero = numeroWhatsapp(valor);
    if (!numero) return aviso('Escribe el celular completo (10 dígitos, ej. 300 123 4567).', 'error');
    setEnviando(true);
    await abrirWhatsapp(numero, datos, negocio, aviso);
    alVolver();
  };

  return (
    <div className="flex flex-col gap-1.5 w-full mt-6">
      <label className="text-xs font-semibold text-gray-500" htmlFor="recibo-destino">
        {esCorreo ? 'Correo para enviar el recibo' : 'Celular (WhatsApp) para enviar el recibo'}
        {deCliente && <span className="font-normal"> · de {deCliente}</span>}
      </label>
      <div className="flex gap-2">
        <input
          id="recibo-destino"
          autoFocus
          type={esCorreo ? 'email' : 'tel'}
          inputMode={esCorreo ? 'email' : 'tel'}
          autoComplete="off"
          value={valor}
          onChange={e => { setValor(e.target.value); setDeCliente(''); }}
          onKeyDown={e => { if (e.key === 'Enter') void enviar(); }}
          placeholder={esCorreo ? 'cliente@correo.com' : '300 123 4567'}
          className="flex-1 min-w-0 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none"
        />
        <button onClick={() => void enviar()} disabled={enviando}
          className={`text-white py-2 px-3 text-xs rounded-lg flex items-center justify-center gap-1 ${esCorreo ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-green-500 hover:bg-green-600'}`}>
          <Send size={14} /> {enviando ? 'Enviando…' : 'Enviar'}
        </button>
        <button onClick={alVolver} disabled={enviando} className="py-2 px-3 text-xs rounded-lg border border-gray-200 flex items-center justify-center gap-1" aria-label="Volver">
          <ArrowLeft size={14} />
        </button>
      </div>
    </div>
  );
}

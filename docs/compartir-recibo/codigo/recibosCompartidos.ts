// ── Cliente: llamar a la función del correo y crear/leer el enlace de WhatsApp ──
//
// Origen: src/utils/api.ts (llamarFuncionHttp, enviarReciboPorCorreo,
// crearReciboCompartido, leerReciboCompartido, mensajeErrorFuncion). En el original
// pasan por la capa `api.ts` (modo local, `sinRed()`, `configFirebase`); aquí se
// escribieron directo contra el SDK de Firebase para que no dependan de nada más
// que de `initializeApp()` ya ejecutado.
import { getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';
import type { DatosTicket, ConfigNegocio, ReciboCorreo } from './tiposRecibo';

// Región donde se desplegó la función (por defecto de Firebase: us-central1).
const REGION = 'us-central1';
// Dónde está publicada la página /recibo/:id que abre el cliente. Por defecto, el
// sitio de Hosting del proyecto; cámbialo si usa dominio propio o un sitio aparte.
const urlBaseRecibos = () => 'https://' + proyecto() + '.web.app';
const COLECCION = 'recibos_compartidos';
const ESPERA_ENLACE_MS = 8000;

const proyecto = (): string => {
  const id = getApp().options.projectId;
  if (!id) throw new Error('Firebase no tiene projectId configurado.');
  return id;
};

/**
 * Las funciones de recibos son onRequest (no callable): se llaman por HTTP, con el
 * token de sesión del personal (la función rechaza a quien no lo trae).
 */
async function llamarFuncionHttp(nombre: string, payload: unknown): Promise<any> {
  const usuario = getAuth().currentUser;
  if (!usuario) throw new Error('Inicia sesión para enviar recibos.');
  const token = await usuario.getIdToken();
  const url = 'https://' + REGION + '-' + proyecto() + '.cloudfunctions.net/' + nombre;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(payload),
  });
  // La función responde { error } con un mensaje ya legible.
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) throw new Error(cuerpo?.error || 'El servidor respondió ' + r.status + '.');
  return cuerpo;
}

/** Manda el recibo por correo; `pdfBase64` (opcional) va adjunto. */
export async function enviarReciboPorCorreo(
  payload: { to: string; recibo: ReciboCorreo; pdfBase64?: string },
): Promise<void> {
  await llamarFuncionHttp('enviarReciboCorreo', payload);
}

/**
 * Guarda el TEXTO del recibo (no un archivo) y devuelve el enlace para mandarlo por
 * WhatsApp. El enlace abre /recibo/<código>, que muestra el recibo y arma el PDF en
 * el celular de quien lo abre: en Firebase queda solo un documento de unos 500 bytes.
 * El código es aleatorio de 128 bits: solo entra quien recibe el enlace.
 */
export async function crearReciboCompartido(recibo: { datos: DatosTicket; negocio: ConfigNegocio }): Promise<string> {
  // Sin conexión la escritura quedaría en cola y el cliente abriría un enlace vacío.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Sin conexión: no se puede crear el enlace del recibo.');
  }
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  // JSON limpia los `undefined`, que Firestore rechaza.
  const limpio = JSON.parse(JSON.stringify(recibo));
  // Se espera la confirmación del servidor: si el enlace sale antes de que el
  // documento exista, el cliente vería "no encontrado".
  await Promise.race([
    setDoc(doc(getFirestore(), COLECCION, id), {
      datos: limpio.datos, negocio: limpio.negocio, creado_en: serverTimestamp(),
    }),
    new Promise((_, no) => setTimeout(() => no(new Error('El servidor no respondió a tiempo.')), ESPERA_ENLACE_MS)),
  ]);
  return urlBaseRecibos() + '/recibo/' + id;
}

/** Lee un recibo compartido por su código (lo usa la página pública /recibo/:id). */
export async function leerReciboCompartido(id: string): Promise<{ datos: any; negocio: any } | null> {
  try {
    const snap = await getDoc(doc(getFirestore(), COLECCION, id));
    return snap.exists() ? (snap.data() as { datos: any; negocio: any }) : null;
  } catch {
    return null;
  }
}

export function mensajeErrorFuncion(e: any): string {
  return String(e?.message || e);
}

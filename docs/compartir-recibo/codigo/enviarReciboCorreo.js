// Cloud Function `enviarReciboCorreo` (Firebase Functions v2, Node 22, onRequest).
//
// COPIA de functions/index.js (líneas 1-146) sin lo que no pertenece a esta función
// (avisos, usuarios, push). Va en functions/index.js del otro proyecto, o en su
// propio archivo exportado desde allí:   exports.enviarReciboCorreo = require("./enviarReciboCorreo").enviarReciboCorreo;
//
// Dependencias (functions/package.json): cors, nodemailer, firebase-admin >= 14,
// firebase-functions >= 6.  Secreto: GMAIL_APP_PASSWORD (ver 03-desplegar-y-probar.md).
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const cors = require("cors")({ origin: true });
const nodemailer = require("nodemailer");
// firebase-admin 14 quitó la forma antigua (admin.firestore(), admin.auth()…): se
// usan los módulos por separado.
const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

// Si esto vive en el index.js del proyecto, ese archivo ya llama initializeApp():
// borra estas dos líneas.
if (!getApps().length) initializeApp();

// Contraseña de aplicación de Gmail, guardada en Secret Manager (nunca en el
// código fuente). Configurar/rotar con:
//   firebase functions:secrets:set GMAIL_APP_PASSWORD
const gmailAppPassword = defineSecret("GMAIL_APP_PASSWORD");

// ⚠ ADAPTAR: la cuenta desde la que sale el correo y el nombre que ve el cliente.
// No son secretos, pero tampoco deben estar fijos en el código: se pueden dar con
// variables de entorno al desplegar (functions/.env).
const CUENTA_CORREO = process.env.GMAIL_USER || "cuenta-del-negocio@gmail.com";
const NOMBRE_REMITENTE = process.env.NOMBRE_NEGOCIO || "Mi Negocio";

// ⚠ ADAPTAR: roles que pueden mandar recibos (valor del campo `rol` en usuarios/{uid}).
const ROLES_PERMITIDOS = ["admin", "caja"];

// ⚠ ADAPTAR: zona horaria y moneda del correo.
const ZONA_HORARIA = "America/Bogota";
const _cop = (n) => new Intl.NumberFormat("es-CO", {
  style: "currency", currency: "COP", maximumFractionDigits: 0,
}).format(Number(n) || 0);

const _esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// El recibo va en el CUERPO del correo (además del PDF adjunto): se ve en cualquier
// celular sin abrir nada. Todo texto que viene del cliente HTTP pasa por _esc().
function _armarRecibo(r) {
  const items = Array.isArray(r.items) ? r.items.slice(0, 200) : [];
  const negocio = r.negocio || {};
  const nombre = negocio.nombre || NOMBRE_REMITENTE;
  const fecha = r.fecha ? new Date(r.fecha) : new Date();
  const fechaTxt = isNaN(fecha) ? "" : fecha.toLocaleString("es-CO", { timeZone: ZONA_HORARIA });

  const filas = items.map((i) => `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #eee">${_esc(i.qty)} × ${_esc(i.nombre)}<br>
        <span style="color:#888;font-size:12px">${_cop(i.precio)} c/u</span></td>
      <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${_cop((Number(i.qty) || 0) * (Number(i.precio) || 0))}</td>
    </tr>`).join("");

  const linea = (et, val, extra = "") =>
    `<tr><td style="padding:3px 0;${extra}">${et}</td><td style="padding:3px 0;text-align:right;${extra}">${val}</td></tr>`;

  const html = `
    <div style="font-family:Arial,sans-serif;color:#222;max-width:480px;margin:auto;padding:16px">
      <h2 style="margin:0 0 4px">${_esc(nombre)}</h2>
      ${negocio.nit ? `<div style="color:#666;font-size:13px">NIT: ${_esc(negocio.nit)}</div>` : ""}
      ${negocio.direccion ? `<div style="color:#666;font-size:13px">${_esc(negocio.direccion)}</div>` : ""}
      ${negocio.telefono ? `<div style="color:#666;font-size:13px">Tel: ${_esc(negocio.telefono)}</div>` : ""}
      <p style="margin:16px 0 4px;font-size:14px"><strong>Recibo ${_esc(r.numero || "")}</strong><br>
        ${_esc(fechaTxt)}${r.cliente ? `<br>Cliente: ${_esc(r.cliente)}` : ""}${r.metodo ? `<br>Pago: ${_esc(r.metodo)}` : ""}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px">${filas}</table>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px">
        ${Number(r.descuento) > 0 ? linea("Subtotal", _cop(r.subtotal)) + linea("Descuento", "−" + _cop(r.descuento)) : ""}
        ${linea("TOTAL", _cop(r.total), "font-weight:bold;font-size:16px")}
        ${Number(r.efectivo_recibido) > 0 && String(r.metodo).toLowerCase() === "efectivo"
          ? linea("Efectivo recibido", _cop(r.efectivo_recibido)) + linea("Cambio", _cop(r.cambio)) : ""}
      </table>
      <p style="margin-top:20px;text-align:center;color:#555;font-size:13px">${_esc(negocio.mensaje || "¡Gracias por su compra!")}</p>
    </div>`;

  const texto = [
    nombre, "Recibo " + (r.numero || ""), fechaTxt, "",
    ...items.map((i) => `• ${i.qty} x ${i.nombre} — ${_cop((Number(i.qty) || 0) * (Number(i.precio) || 0))}`),
    "", "TOTAL: " + _cop(r.total), "", negocio.mensaje || "¡Gracias por su compra!",
  ].join("\n");

  return { html, texto };
}

// Solo el personal autorizado puede mandar recibos. Sin esto, la URL pública de la
// función serviría para enviar correo desde el Gmail del negocio a cualquiera.
// `invoker: "public"` es necesario para que el navegador llegue a la función; la
// comprobación de identidad la hace este código con el token de sesión (ID token de
// Firebase Auth en `Authorization: Bearer …`). Devuelve true si el llamado puede
// seguir; si no, ya respondió el error.
async function _exigirPersonal(req, res) {
  const cabecera = req.get("Authorization") || "";
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!token) { res.status(401).send({ error: "Inicia sesión para enviar recibos." }); return false; }

  const decodificado = await getAuth().verifyIdToken(token).catch(() => null);
  if (!decodificado) { res.status(401).send({ error: "Tu sesión venció. Vuelve a iniciar sesión." }); return false; }
  // ⚠ ADAPTAR: de dónde sale el rol. Aquí: documento usuarios/{uid} con campo `rol`.
  // (Alternativa: un custom claim en `decodificado.rol` y ahorrarse esta lectura.)
  const perfil = await getFirestore().collection("usuarios").doc(decodificado.uid).get();
  if (!perfil.exists || !ROLES_PERMITIDOS.includes(perfil.data().rol)) {
    res.status(403).send({ error: "Tu usuario no puede enviar recibos." }); return false;
  }
  return true;
}

// El PDF lo arma la app (reciboPdf.ts). Se acepta hasta ~1 MB: un recibo pesa unos
// 5 KB, así que más que eso no es un recibo.
const _PDF_MAX_BASE64 = 1.4 * 1024 * 1024;
const _pdfValido = (b64) => typeof b64 === "string" && b64.length > 100 && b64.length < _PDF_MAX_BASE64;
const _nombreArchivo = (numero) => "Recibo_" + String(numero || "compra").replace(/[^\w.-]/g, "_") + ".pdf";

exports.enviarReciboCorreo = onRequest({ invoker: "public", secrets: [gmailAppPassword] }, (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send({ error: "Method Not Allowed" });
    }

    try {
      if (!(await _exigirPersonal(req, res))) return;

      const { to, recibo, pdfBase64 } = req.body || {};
      if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to)) || !recibo) {
        return res.status(400).send({ error: "Faltan el correo o los datos del recibo." });
      }

      const { html, texto } = _armarRecibo(recibo);
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: CUENTA_CORREO, pass: gmailAppPassword.value() },
      });

      await transporter.sendMail({
        // El remitente DEBE ser la misma cuenta autenticada. Si no coinciden, Gmail
        // reescribe el encabezado en silencio y el correo sale de la otra dirección
        // — o cae en spam.
        from: '"' + NOMBRE_REMITENTE + '" <' + CUENTA_CORREO + '>',
        to: String(to),
        subject: "Recibo de compra " + (recibo.numero || ""),
        text: texto,
        html,
        // El recibo va en el cuerpo Y en PDF; si la app no pudo armar el PDF, el
        // correo sale igual con el cuerpo.
        attachments: _pdfValido(pdfBase64)
          ? [{ filename: _nombreArchivo(recibo.numero), content: pdfBase64, encoding: "base64", contentType: "application/pdf" }]
          : [],
      });
      return res.status(200).send({ success: true });
    } catch (error) {
      console.error("Error al enviar el recibo por correo:", error);
      return res.status(500).send({ error: "No se pudo enviar el correo: " + (error.message || error) });
    }
  });
});

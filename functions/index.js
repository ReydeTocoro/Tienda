/* Firebase Function serving the store's write API — Hosting rewrites /api/** here (firebase.json).
 * The API itself is server/ (TypeScript), bundled into lib/server.js by `npm run build:functions`. */
const { onRequest } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { defineSecret } = require('firebase-functions/params')
const { initializeApp } = require('firebase-admin/app')
const { getMessaging } = require('firebase-admin/messaging')
const { createServerApp, sendScheduledPush } = require('./lib/server.js')

// All three live in Secret Manager, and all must exist before a deploy:
//   firebase functions:secrets:set SUPABASE_DB_URL      (the database URL, it carries the password)
//   firebase functions:secrets:set SUPABASE_SECRET_KEY  (creates the users' sign-in accounts)
//   firebase functions:secrets:set GMAIL_APP_PASSWORD   (the app password of the Gmail account in functions/.env,
//                                                        which e-mails the receipts)
const SUPABASE_DB_URL = defineSecret('SUPABASE_DB_URL')
const SUPABASE_SECRET_KEY = defineSecret('SUPABASE_SECRET_KEY')
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD')

// Ashburn, Virginia: next to the Supabase database (AWS us-east-1).
const REGION = 'us-east4'

// The Administrador's phone notifications, through Firebase Cloud Messaging with the project's own credentials (no
// secret needed). Sent as data, so the app's service worker (public/push-sw.js) shows them the same way everywhere.
const GONE = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'])
let messaging
async function sendPush(tokens, { title, body }) {
  messaging ??= getMessaging(initializeApp())
  const res = await messaging.sendEachForMulticast({
    tokens,
    data: { title, body, link: '/?avisos=1' },
    // A reminder that waited more than 3 hours (the phone was off) is stale: the next one is on its way.
    webpush: { headers: { TTL: '10800', Urgency: 'high' } },
  })
  return res.responses.flatMap((r, i) => (!r.success && GONE.has(r.error?.code) ? [tokens[i]] : []))
}

let app

exports.api = onRequest(
  {
    region: REGION,
    // Reachable from the browser through Hosting; the API itself demands a staff session.
    invoker: 'public',
    secrets: [SUPABASE_DB_URL, SUPABASE_SECRET_KEY, GMAIL_APP_PASSWORD],
    memory: '512MiB',
    timeoutSeconds: 60,
    maxInstances: 2,
    concurrency: 40,
  },
  (req, res) => {
    app ??= createServerApp({
      dbUrl: SUPABASE_DB_URL.value(),
      supabaseUrl: process.env.SUPABASE_URL,
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
      secretKey: SUPABASE_SECRET_KEY.value(),
      mail: { user: process.env.GMAIL_USER, password: GMAIL_APP_PASSWORD.value() },
      push: sendPush,
    })
    return app(req, res)
  },
)

// "Pendientes de hoy" on the Administrador's phone at 7:00, 12:20, 17:00, 18:00 and 20:00 in Colombia (the app says the
// same: PUSH_HOURS_LABEL in src/features/notifications/lib/notices.ts). One schedule can't hold 12:20 with the others.
const pendingAt = (schedule) =>
  onSchedule({ schedule, timeZone: 'America/Bogota', region: REGION, secrets: [SUPABASE_DB_URL], memory: '256MiB', timeoutSeconds: 120, retryCount: 0 }, async () => {
    console.log('Avisos de pendientes:', await sendScheduledPush(SUPABASE_DB_URL.value(), sendPush))
  })

exports.avisosPendientes = pendingAt('0 7,17,18,20 * * *')
exports.avisosMediodia = pendingAt('20 12 * * *')

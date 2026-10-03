/* Firebase Function serving the store's write API — Hosting rewrites /api/** here (firebase.json).
 * The API itself is server/ (TypeScript), bundled into lib/server.js by `npm run build:functions`. */
const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { createServerApp } = require('./lib/server.js')

// The Supabase database URL (it carries the password) lives in Secret Manager:
//   firebase functions:secrets:set SUPABASE_DB_URL
const SUPABASE_DB_URL = defineSecret('SUPABASE_DB_URL')

let app

exports.api = onRequest(
  {
    // Ashburn, Virginia: next to the Supabase database (AWS us-east-1).
    region: 'us-east4',
    // Reachable from the browser through Hosting; the API itself demands a staff session.
    invoker: 'public',
    secrets: [SUPABASE_DB_URL],
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
    })
    return app(req, res)
  },
)

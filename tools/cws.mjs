#!/usr/bin/env node
/**
 * Chrome Web Store API v2 client.
 *
 * v1.1 is deprecated on 15 October 2026, so this targets v2 only. v2 also
 * accepts a service account, which is why there is no refresh token here to
 * expire quietly in six months' time.
 *
 * Authentication is a signed JWT exchanged for an access token - implemented
 * directly rather than pulling in google-auth-library, so the whole release
 * path stays dependency-free and auditable.
 *
 *   node cws.mjs upload  <zip>    upload a package as a draft (nothing goes live)
 *   node cws.mjs publish          submit the draft for review
 *   node cws.mjs status           report the item's current state
 *   node cws.mjs cancel           withdraw a pending submission
 *
 * Reads CWS_SERVICE_ACCOUNT_KEY (the service account JSON), CWS_PUBLISHER_ID
 * and CWS_ITEM_ID from the environment.
 */

import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SCOPE = 'https://www.googleapis.com/auth/chromewebstore'
const BASE = 'https://chromewebstore.googleapis.com'

const b64url = input =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * Exchange the service account key for an access token.
 * Standard two-legged OAuth: sign a JWT asserting who we are, trade it in.
 */
export async function getAccessToken(serviceAccountJson) {
  const key = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson
  if (!key.client_email || !key.private_key) {
    throw new Error('Service account key is missing client_email or private_key')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    })
  )

  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  const signature = b64url(signer.sign(key.private_key))
  const assertion = `${header}.${claim}.${signature}`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  })

  const body = await response.json()
  if (!response.ok) {
    throw new Error(
      `Token exchange failed (${response.status}): ${body.error_description || body.error || JSON.stringify(body)}\n` +
        'Check that the Chrome Web Store API is enabled in the GCP project and that the\n' +
        "service account's email has been added under Account in the Developer Dashboard."
    )
  }
  return body.access_token
}

function itemPath(publisherId, itemId) {
  return `publishers/${publisherId}/items/${itemId}`
}

async function call(token, url, { method = 'GET', body, contentType } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(contentType ? { 'content-type': contentType } : {})
    },
    body
  })

  const text = await response.text()
  let parsed
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }

  if (!response.ok) {
    const detail = parsed.error?.message || parsed.raw || JSON.stringify(parsed)
    throw new Error(`${method} ${url.replace(BASE, '')} failed (${response.status}): ${detail}`)
  }
  return parsed
}

/** Upload a package. Creates a DRAFT revision - nothing reaches users. */
export async function upload(token, publisherId, itemId, zipPath) {
  return call(token, `${BASE}/upload/v2/${itemPath(publisherId, itemId)}:upload`, {
    method: 'POST',
    body: readFileSync(zipPath),
    contentType: 'application/zip'
  })
}

/**
 * Submit the draft for review.
 *
 * publishType STAGED_PUBLISH holds an approved item rather than releasing it.
 * deployPercentage needs 10,000+ users, which none of these have yet.
 */
export async function publish(token, publisherId, itemId, options = {}) {
  const body = {}
  if (options.staged) body.publishType = 'STAGED_PUBLISH'
  if (options.deployPercentage != null) {
    body.deployInfos = [{ deployPercentage: options.deployPercentage }]
  }
  if (options.blockOnWarnings) body.blockOnWarnings = true

  return call(token, `${BASE}/v2/${itemPath(publisherId, itemId)}:publish`, {
    method: 'POST',
    body: JSON.stringify(body),
    contentType: 'application/json'
  })
}

export async function fetchStatus(token, publisherId, itemId) {
  return call(token, `${BASE}/v2/${itemPath(publisherId, itemId)}:fetchStatus`)
}

/** Withdraw a pending submission. The abort button. */
export async function cancelSubmission(token, publisherId, itemId) {
  return call(token, `${BASE}/v2/${itemPath(publisherId, itemId)}:cancelSubmission`, {
    method: 'POST',
    body: '{}',
    contentType: 'application/json'
  })
}

/** Plain-English rendering of a fetchStatus response. */
export function describeStatus(status) {
  const lines = []
  const published = status.publishedItemRevisionStatus?.state
  const submitted = status.submittedItemRevisionStatus?.state

  if (published) lines.push(`published revision: ${published}`)
  if (submitted) lines.push(`submitted revision: ${submitted}`)
  if (status.lastAsyncUploadState) lines.push(`last upload: ${status.lastAsyncUploadState}`)
  if (status.takenDown) lines.push('TAKEN DOWN by the store')
  if (status.warned) lines.push('WARNED by the store')

  for (const channel of status.publishedItemRevisionStatus?.distributionChannels ?? []) {
    lines.push(`  channel: crx ${channel.crxVersion} at ${channel.deployPercentage ?? 100}%`)
  }
  return lines.join('\n') || 'no status reported'
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [command, arg] = process.argv.slice(2)
  const { CWS_SERVICE_ACCOUNT_KEY, CWS_PUBLISHER_ID, CWS_ITEM_ID } = process.env

  for (const [name, value] of Object.entries({ CWS_SERVICE_ACCOUNT_KEY, CWS_PUBLISHER_ID, CWS_ITEM_ID })) {
    if (!value) {
      console.error(`Missing ${name}`)
      process.exit(1)
    }
  }

  const token = await getAccessToken(CWS_SERVICE_ACCOUNT_KEY)
  const run = {
    upload: () => upload(token, CWS_PUBLISHER_ID, CWS_ITEM_ID, arg),
    publish: () => publish(token, CWS_PUBLISHER_ID, CWS_ITEM_ID, { staged: process.env.CWS_STAGED === 'true' }),
    status: () => fetchStatus(token, CWS_PUBLISHER_ID, CWS_ITEM_ID),
    cancel: () => cancelSubmission(token, CWS_PUBLISHER_ID, CWS_ITEM_ID)
  }[command]

  if (!run) {
    console.error('Usage: cws.mjs <upload <zip>|publish|status|cancel>')
    process.exit(1)
  }

  const result = await run()

  const state =
    result.submittedItemRevisionStatus?.state ??
    result.publishedItemRevisionStatus?.state ??
    result.state ??
    result.uploadState ??
    'UNKNOWN'

  // --state prints only the state, so a shell loop can branch on it without
  // parsing mixed JSON-and-prose output.
  if (process.argv.includes('--state')) {
    console.log(state)
  } else {
    console.log(JSON.stringify(result, null, 2))
    if (command === 'status') console.log(`\n${describeStatus(result)}`)
  }

  // Surface the state for the workflow to branch on.
  if (process.env.GITHUB_OUTPUT && !process.argv.includes('--state')) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`, { flag: 'a' })
  }
}

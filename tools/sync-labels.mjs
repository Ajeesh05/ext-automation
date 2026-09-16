#!/usr/bin/env node
/**
 * Creates the pipeline's labels in every project repo listed in registry.yml.
 *
 * Labels are the state machine; comments are the verb. A comment is what you
 * can send from a phone in one tap, and it leaves an audit trail; the label is
 * what the workflows and queries read.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const LABELS = [
  // Lifecycle
  ['ai-proposal', '0e8a16', 'Raised by the proposal scanner'],
  ['awaiting-approval', 'fbca04', 'Waiting for you to comment /approve or /reject'],
  ['approved', '0e8a16', 'Approved; implementation dispatched'],
  ['rejected', 'e4e669', 'Declined, with a reason recorded'],
  ['in-progress', '1d76db', 'An agent is working on this now'],
  ['blocked/manual', 'b60205', 'Stopped safely; needs a human decision'],

  // Gates
  ['needs-permission-approval', 'd93f0b', 'Requests more permissions than the baseline allows'],
  ['awaiting-release-approval', 'fbca04', 'Uploaded as a store draft; waiting for /approve-release'],
  ['released', '5319e7', 'Submitted to the store'],
  ['store-rejected', 'b60205', 'The store rejected this submission'],

  // Classification
  ['kind:bug', 'd73a4a', ''],
  ['kind:security', 'b60205', ''],
  ['kind:perf', 'c5def5', ''],
  ['kind:ux', 'c2e0c6', ''],
  ['kind:feature', 'a2eeef', ''],
  ['kind:debt', 'bfd4f2', ''],
  ['kind:compliance', 'f9d0c4', ''],
  ['risk:low', 'c2e0c6', ''],
  ['risk:medium', 'fbca04', ''],
  ['risk:high', 'd93f0b', '']
]

const gh = args => {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: 'pipe' })
  } catch (error) {
    return { error: (error.stderr || error.message).toString().trim() }
  }
}

const registry = parse(readFileSync('registry.yml', 'utf8'))

for (const project of registry.projects) {
  console.log(`\n${project.repo}`)
  for (const [name, color, description] of LABELS) {
    const result = gh([
      'label', 'create', name,
      '--repo', project.repo,
      '--color', color,
      '--description', description,
      '--force'
    ])
    console.log(result.error ? `  FAILED ${name}: ${result.error}` : `  ${name}`)
  }
}

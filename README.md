# ext-automation

Orchestrator for the autonomous extension pipeline: shared tooling, the approval
queue, and the workflows that hold deployment credentials.

Architecture and roadmap: see the plan this was built from.
Audit findings awaiting triage: [FINDINGS.md](FINDINGS.md).

## Layout

```
tools/          shared, synced into each project's tests/helpers/
  chrome-mock.mjs    chrome.* double; speaks both promise and callback styles
  sw-harness.mjs     loads a classic MV3 service worker in a vm, unmodified
  pack.mjs           the shippable file set: directory or deterministic zip
  lint-ratchet.mjs   per-file error baseline; errors may shrink, never grow
registry.yml    every project the orchestrator knows about
```

## Projects

| Project | Autonomy | Unit | E2E | Lint baseline |
|---|---|---|---|---|
| mini_keep | `full` | 36 | 5 | 0 |
| cookie_editor_and_storage_manager | `propose` | 131 | 9 | 0 |
| gmeet_kit | `audit` | 44 | 13 | 9 |

Autonomy levels are per-project on purpose. `mini_keep` is a 240-line popup;
Cookie Editor holds `<all_urls>` and `cookies` and can read every session cookie
on the web; gmeet_kit has a known ReferenceError. They do not warrant the same
level of trust.

## Syncing tools

`tools/` is the source of truth. Each project carries a copy under
`tests/helpers/`. Edit here, then sync — a project-local edit is overwritten.

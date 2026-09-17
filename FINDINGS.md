# Audit findings

Surfaced while adding the test suites (Phase 1). None are fixed — each becomes a
tracked issue once `gh` is installed and the orchestrator repo exists, so the
pipeline's first real work is remediation it can be measured against.

Severity: **crash** breaks at runtime today · **defect** wrong behaviour ·
**risk** works now, fragile by construction · **hygiene** no user impact.

## gmeet_kit

| # | Sev | Where | Finding |
|---|-----|-------|---------|
| 1 | **crash** | `scripts/sidebar.js:350,357` | `normalizeMeetingId()` is called but defined nowhere in the codebase. `sidebar.html` loads only `sidebar.js`, so there is no sibling script to supply it. `tryLoadRecentLiveSession()` throws `ReferenceError` every time it runs. |
| 2 | **defect** | `scripts/sidebar.js:126` | `chrome.scripting.executeScript` is called, but `scripting` is not in `manifest.json` permissions. The call is inside a `try/catch` returning `false`, so the recorder-detection fallback silently never works. |
| 3 | **defect** | `manifest.json` | `minimum_chrome_version` was lowered from `120` to `88`, but `chrome.sidePanel` requires Chrome 114+. Users on 88–113 install successfully and hit an undefined API. |
| 4 | **risk** | `scripts/background.js:238` | `meetingSessions` lives only in service-worker memory, mirrored to `storage.local` by a 1-second `setInterval`. MV3 recycles the worker at will, and the interval is fighting that lifecycle rather than using `chrome.alarms`. In-flight meetings are lost on recycle, and `onStartup` only recovers them on browser start. This also made E2E flaky ~1 run in 3 before the fixture warmed the worker. |
| 5 | **defect** | `scripts/background.js:70` | `sendMessageToActiveTab(retries - 1)` passes the retry count as the *message*, dropping the real message and resetting `retries` to its default. Covered by a `todo` test. |
| 6 | **hygiene** | 4 files, 9 errors | Implicit globals from `x = value` with no declaration: `data` ×3 (`ports.js`), `html` ×2 (`saved-links.js`), `moreOptionsDiv`, `timeString` (`enhancer.js`). Work in sloppy mode; break under `"use strict"` or any module conversion. Held at exactly 9 by the lint ratchet. |
| 7 | **hygiene** | `manifest.json` | `sidebar.html` and `scripts/sidebar.js` ship, but the manifest has no `side_panel` key — only the `sidePanel` permission. The panel is opened programmatically, which works, but the declarative default is missing. |
| 8 | **defect** | `manifest.json` | **Two different builds share version 2.3.0.** Confirmed against the live store on 2026-09-17: the Chrome Web Store serves `2.3.0`, and the local `2.3.0` is a substantially different codebase — the refactor added ~3,000 lines including the caption recorder and sidebar. Nothing identifies which build a user is running, and the store will reject any upload until the version increases. Left as-is for now: the new features stay unshipped rather than shipping a release that still contains finding 1. |
| 9 | review | `scripts/popup/saved-links.js:59` | `innerHTML` with a template literal built from stored link data. Worth confirming the data cannot carry markup. |

**Consequence:** gmeet_kit is set to `autonomy: audit` in its `project.yml`. A
project with a known ReferenceError in it is not one to point an autonomous
agent at. It should move to `propose` once findings 1–3 are fixed and the lint
baseline reaches zero.

## mini_keep

| # | Sev | Where | Finding |
|---|-----|-------|---------|
| 10 | hygiene | `background.js:194` | `closeKeep()` is never called from anywhere. |

## Cookie Editor & Storage Manager

No findings. Lint baseline is zero and the suite is strict.

## Cross-cutting

- **No `side_panel` E2E for a real side panel.** Chrome's side panel cannot be
  driven by Playwright, so the Cookie Editor suite opens `sidepanel.html` as a
  tab and pins `chrome.tabs.query`. Everything downstream is real; that one seam
  is not.
- **Meet's DOM is not reproduced.** `enhancer.js` drives obfuscated Meet class
  names. E2E covers the origin, the content-script boundary, the injection
  contract and the postMessage bridge — not the call-control logic.


---

## Store state, as observed 2026-09-17

Read from the Chrome Web Store API, not assumed:

| Extension | Live version | Local version | Uploadable |
|---|---|---|---|
| mini_keep | 1.0.2 | 1.1.1 | yes |
| Cookie Editor | 1.0.1 | 1.0.1 | no — identical, needs a release |
| gmeet_kit | 2.3.0 | 2.3.0 | no — see finding 8 |

All three `PUBLISHED` at 100%, none warned or taken down.

Cookie Editor's local 1.0.1 also differs from the shipped 1.0.1: it carries the
bulk-operation error reporting and expanded-row preservation committed on
2026-09-16. The same collision as finding 8, smaller in scope and with no known
crash behind it, so cutting a release there is uncontroversial whenever wanted.

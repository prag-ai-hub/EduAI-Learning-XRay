# Dependency decisions

Most dependencies need no explanation: they come from the registry, at a
semver range, and `npm audit` tells you when to move. This page exists for the
ones where the obvious thing is wrong, and records why — so nobody "tidies up"
the odd-looking line six months from now and reintroduces the problem.

## `xlsx` is pinned to a vendor tarball, not a registry range

```json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

### The problem

SheetJS stopped publishing to the npm registry at **0.18.5**. Every later
release, including both security fixes, exists only on the vendor's own CDN.
So the newest version npm will resolve carries two high-severity advisories
that will never be fixed there:

| Advisory | Affects | Fixed in |
|---|---|---|
| [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) — prototype pollution | `<0.19.3` | 0.19.3 |
| [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) — ReDoS | `<0.20.2` | 0.20.2 |

`npm audit` reports both as **"No fix available"**, because from the
registry's point of view there is none.

This is not theoretical here. Both call sites parse a file a user uploaded:

* `app/src/server/document-text.ts` — server-side text extraction, reached by
  the OCR and document pipeline.
* the roster import (bulk student upload), still in `frontend/` and due to be
  ported into `app/src/features/`.

Untrusted bytes reaching a parser with a live prototype-pollution advisory is
the whole shape of the problem.

### Why the vendor tarball

The GitHub advisory itself points at the CDN, which is the vendor's supported
distribution channel. It clears both advisories, and the public API is
unchanged, so neither call site needed rewriting — `XLSX.read`,
`utils.sheet_to_csv` and `utils.sheet_to_json` all behave as before, on both
`.xlsx` and legacy `.xls`.

Reproducibility was the thing worth checking, and it holds. `package-lock.json`
records the tarball with a sha512 integrity hash exactly as it would a registry
package:

```json
"node_modules/xlsx": {
  "version": "0.20.3",
  "resolved": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
  "integrity": "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==",
```

`npm ci` reinstalls from that hash, so a tampered or swapped tarball fails the
install rather than shipping. 0.20.3 also vendors what 0.18.5 pulled in as
seven separate registry packages, so the tree got smaller, not larger.

### What was rejected, and why

**exceljs 4.4.0.** Registry-native and maintained, but it is a worse trade on
every axis that matters here. It brings nine transitive dependencies —
including `uuid@^8`, which this repo's own `npm audit` already flags under
GHSA-w5hq-g745-h8pq — so it swaps one flagged package for a tree containing
another. Its async, streaming API means rewriting both call sites, and it has
no reader for legacy `.xls`, which the file picker accepts today. Trading a
fixed advisory for a silent feature regression is not a fix.

**Dropping to CSV only.** The smallest attack surface, and the answer if this
were a fringe format. It is not: the roster importer's own copy says "Choose
CSV or XLSX roster", and teachers keep rosters in Excel. Removing the format
moves the cost onto every user to save a dependency we can pin correctly.

### The cost, stated plainly

A build host now needs egress to `cdn.sheetjs.com` as well as the npm registry.
If that host is ever unreachable, `npm ci` fails — loudly, at install time,
which is the right failure mode. An air-gapped or registry-mirrored CI would
need the tarball mirrored into its own registry; that is the trigger to
revisit this choice, not a reason to drop back to 0.18.5.

### Upgrading

There is no `npm outdated` signal for a URL dependency. Check
<https://cdn.sheetjs.com/> for a newer version, then replace the URL in
`app/package.json` and re-run `npm install xlsx@<new url>` so the lock picks up
the new integrity hash. 0.20.3 is the latest at the time of writing — 0.20.4
and 0.21.0 return 404.

### Hardening at the call site

The upgrade clears the advisories; it does not make the library's object model
safe to index with attacker-controlled keys. Sheet names come out of the
uploaded file, and on 0.20.3 a workbook whose sheet is named `__proto__` still
ends up reachable only through `Sheets`'s prototype rather than as an own
property. `extractSpreadsheet` therefore honours a sheet name only when it is
genuinely an own key of `workbook.Sheets`, and skips it otherwise. Real sheets
are unaffected; a sheet named `__proto__` is dropped instead of being read off
the prototype chain.

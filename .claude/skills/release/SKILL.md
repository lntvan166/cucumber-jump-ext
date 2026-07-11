---
name: release
description: Release Cucumber Jump to the VS Code Marketplace and Open VSX. Use when the user asks to release, publish, or ship a new version of the extension.
---

# Releasing Cucumber Jump

Publish to **both** registries, always: the VS Code Marketplace (`vsce`) and
Open VSX (`ovsx`). Open VSX is what lets **Cursor** users install and
auto-update the extension — skipping it strands them on old versions.

## Preconditions

- `OVSX_PAT` env var must be set (lives in `~/.zshrc`, never committed). If it
  is missing, stop and ask the user to run `source ~/.zshrc` or provide it.
- `vsce` is a devDependency; `ovsx` runs via `npx ovsx`.
- A personal access token for the Marketplace publisher `lntvan166` must be
  available to `vsce` (it prompts, or use `VSCE_PAT`).

## Checklist (in order — do not reorder 5 and 6)

1. **Green build.** `npm test` (all Vitest suites) and `npm run compile` must
   pass with zero errors. Never release on a red or dirty tree.
2. **Version + CHANGELOG.** Bump `version` in `package.json` (semver), add a
   dated entry to `CHANGELOG.md` describing user-visible changes. Verify README
   claims still match behavior (test counts, feature claims).
3. **Commit and tag.** Commit the bump, tag `v<version>`.
4. **Merge to `main` and push, BEFORE packaging.** The `package:marketplace`
   script rewrites README image/content links to
   `https://github.com/lntvan166/cucumber-jump-ext/raw/main/...` — packaging
   from an unmerged branch produces a listing with broken demo GIFs and links.
5. **Package.** `npm run package:marketplace` (never plain `npm run package`
   for publishing — it keeps relative links, which break on the listing).
   Sanity-check the artifact: `unzip -l cucumber-jump-ext-<version>.vsix`
   should be ~70 files / well under 1 MB and contain no `CLAUDE.md`, `docs/`,
   `__tests__`, or GIFs.
6. **Smoke test.** Run `python3 manual-test-seed.py` to seed
   `~/cucumber-jump-manual-test` (a multi-language workspace with a
   `TESTPLAN.md` checklist), install the vsix
   (`code --install-extension cucumber-jump-ext-<version>.vsix`), open the
   seeded folder, and walk the checklist. This is manual — ask the user to
   confirm. Clean up with `python3 manual-test-seed.py --clean`.
7. **Publish both registries from the SAME vsix:**
   ```bash
   npx vsce publish --packagePath cucumber-jump-ext-<version>.vsix
   npx ovsx publish cucumber-jump-ext-<version>.vsix -p "$OVSX_PAT"
   ```
8. **Verify the listings.** Check that images render and the new version shows:
   - https://marketplace.visualstudio.com/items?itemName=lntvan166.cucumber-jump-ext
   - https://open-vsx.org/extension/lntvan166/cucumber-jump-ext
   Remember: the Marketplace README renders from the *published package* —
   README fixes only appear on the listing at the next publish.
9. **GitHub release.** `gh release create v<version> cucumber-jump-ext-<version>.vsix
   --title "v<version>" --notes-from-tag` (or paste the CHANGELOG entry).

## Failure notes

- If Marketplace publish succeeds but Open VSX fails (or vice versa), fix and
  re-publish the failed side with the same vsix — do not bump the version.
- Publishing is irreversible: a version number can never be reused. On a bad
  release, bump a patch version and ship the fix.

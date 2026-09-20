# Release checklist

Releases are deliberate; the fork never publishes under an upstream identity.

1. Confirm `UPSTREAM.md` records the current reconciled upstream commit/version.
2. Choose a fork semver and update every manifest checked by `node scripts/check-versions.js`, including `plugin.yaml`.
3. Regenerate derived skills with `node scripts/build-openclaw-skills.js`.
4. Run:
   ```sh
   npm install --prefix ponytail-on-stimulants-mcp
   npm run check
   npm test
   npm run test:completion
   python3 benchmarks/agentic/run.py --selftest
   python3 benchmarks/agentic/complete.py --selftest-offline
   npm pack --dry-run
   ```
5. Inspect the package contents, final diff, repository status, README install commands, fork IDs, and MIT attribution.
6. Confirm no current public metadata points at `DietrichGebert/ponytail` except explicit attribution/upstream links.
7. Confirm `origin` is the owned fork (`git remote get-url origin` must be `https://github.com/phall1/ponytail-on-stimulants.git` or its SSH equivalent) and that `main` tracks `origin/main`. Never push release refs through the canonical `upstream` remote.
8. Configure npm trusted publishing for package `ponytail-on-stimulants` and this repository before the first publish.
9. Commit the version bump on `main`, push that commit with `git push origin main`, create the exact tag `v<version>`, then push only that tag with `git push origin v<version>`. `publish.yml` rejects mismatched tags and tags whose commit is not in `origin/main`; it publishes the exact artifact produced by its validation job.
10. Verify the npm artifact, host marketplace metadata, Git tag, and GitHub release notes. Publish additional ecosystems explicitly; the workflow does not assume they succeeded.
11. Record genuine completion benchmark results separately from inherited upstream results.

Do not release from a dirty tree, a failed check, an unresolved upstream conflict, or a manual workflow that bypasses the tag/version contract.

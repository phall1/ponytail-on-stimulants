# Release checklist

Releases are deliberate; the fork never publishes under an upstream identity.

1. Confirm `UPSTREAM.md` records the current reconciled upstream commit/version.
2. Choose a fork semver and update every manifest checked by `node scripts/check-versions.js`, including canonical `plugin.json` and `plugin.yaml`.
3. Regenerate derived skills with `node scripts/build-openclaw-skills.js`.
4. Run:
   ```sh
   npm run check
   uv run --with pandas==3.0.6 -- npm test
   npm run test:completion
   uv run --script benchmarks/agentic/run.py --selftest
   uv run --script benchmarks/agentic/complete.py --selftest-offline
   npm pack --dry-run
   ```
5. Inspect the package contents, final diff, repository status, README install commands, fork IDs, MIT attribution, Agent Plugins manifest, fixed-layout skills, and packed-artifact MCP smoke coverage.
6. Confirm no current public metadata points at `DietrichGebert/ponytail` except explicit attribution/upstream links.
7. Confirm `origin` is the owned fork (`git remote get-url origin` must be `https://github.com/phall1/ponytail-on-stimulants.git` or its SSH equivalent) and that `main` tracks `origin/main`. Never push release refs through the canonical `upstream` remote.
8. Configure npm trusted publishing for package `ponytail-on-stimulants` and this repository before the first publish.
9. Commit the version bump on `main`, push that commit with `git push origin main`, create the exact tag `v<version>`, then push only that tag with `git push origin v<version>`. `publish.yml` rejects mismatched tags and tags whose commit is not in `origin/main`; it publishes the exact artifact produced by its validation job.
10. Verify the npm artifact, host marketplace metadata, Git tag, and GitHub release notes. Publish additional ecosystems explicitly; the workflow does not assume they succeeded.
11. Record genuine completion benchmark results separately from inherited upstream results.

Do not release from a dirty tree, a failed check, an unresolved upstream conflict, or a manual workflow that bypasses the tag/version contract.

## v0.4.3 maintenance release

- Validated the unchanged OpenCode adapter against OpenCode **2.0.32** in an
  isolated configuration: the local package activates and registers all six
  fork-namespaced commands and skills, without model requests. See
  [the compatibility review](docs/harness-compatibility.md#verification-boundaries)
  for the boundary between loader/regression coverage and live model behavior.
- Refreshed CI to Node 24 LTS, npm 12.2.0, uv 0.13.1, Python 3.15.0 and pandas
  3.0.6; pinned current checkout, setup-node, setup-uv and artifact actions by
  commit. The trusted-publishing environment, exact tag/main ancestry gates and
  validated tarball publication remain unchanged.
- Root and Pi packages remain dependency-free. Prompt bodies, completion
  behavior, fork namespace and upstream/MIT attribution are unchanged; all 12
  release-version entries are synchronized at **0.4.3**.

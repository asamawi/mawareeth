# Current-Technology Review — Mawareeth Infrastructure Spine

**Review date:** 2026-09-02  
**Lens:** Current versions, official support, brownfield reality, and named-technology fit  
**Verdict:** **Changes required.** The core Hetzner + Docker Compose + Caddy + GitHub Actions design is technically viable and its central platform claims check out, but the spine does not yet satisfy its own reproducible/current-version contract. Gunicorn is materially under-specified, the Docker Engine host dependency is missing, and the PostgreSQL migration and low-cost VPS capacity assumptions have not been reality-checked.

## Verified claims

- **Brownfield baseline:** Repository inspection confirms Python `3.12.12`, Django `>=4.2,<5.0`, Gunicorn `>=21.0`, a Heroku-style `Procfile`, a WSGI Docker image, `DATABASE_URL`, WhiteNoise, and the unsafe current `ALLOWED_HOSTS = ['*']`. AD-1, AD-6, AD-7, and AD-9 correctly respond to these conditions.
- **Django:** Django 5.2.17 is the current 5.2 LTS patch and is supported through April 2028; Django 5.2 supports Python 3.12. The target is current and suitable. [Django supported versions](https://www.djangoproject.com/download/), [Django 5.2 release notes](https://docs.djangoproject.com/en/dev/releases/5.2/)
- **PostgreSQL:** PostgreSQL 17.11 is the current 17.x minor and PostgreSQL 17 is supported until November 2029. Choosing 17 rather than the newest major is a defensible maturity choice. [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
- **Caddy:** 2.11.4 is the latest stable release. Caddy officially documents API/`caddy reload` configuration replacement as graceful and zero-downtime, with rollback to the prior configuration when loading fails. This supports the edge-switch portion of AD-5, provided the admin API remains enabled and deployment invokes reload rather than restarting the Caddy container. [Caddy releases](https://github.com/caddyserver/caddy/releases), [Caddy getting started](https://caddyserver.com/docs/getting-started), [Caddy API](https://caddyserver.com/docs/api)
- **Docker Compose:** 5.5.0 is the current documented Compose release. Compose supports service health checks, `up --wait`, targeted `up --no-deps`, and bounded `stop_grace_period`, which are sufficient primitives for two explicitly separate blue/green services. [Docker Compose installation](https://docs.docker.com/compose/install/standalone/), [`docker compose up`](https://docs.docker.com/reference/cli/docker/compose/up/), [Compose services](https://docs.docker.com/reference/compose-file/services/)
- **Gunicorn drain behavior:** Gunicorn handles `TERM` as graceful shutdown and waits for active requests up to `graceful_timeout`; Compose sends `TERM` by default and can bound the later `SIGKILL`. The drain rule is supported, but its actual timeouts must be configured coherently. [Gunicorn signal handling](https://docs.gunicorn.org/en/19.x/signals.html), [Gunicorn settings](https://docs.gunicorn.org/en/stable/settings.html), [Compose services](https://docs.docker.com/reference/compose-file/services/)
- **GHCR:** GitHub Container Registry supports OCI images and GitHub’s publishing workflow exposes the pushed image digest, so digest-addressed deployment is supported. [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), [Publishing Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
- **Mechanical spine lint:** `lint_spine.py` passes with zero findings.

## Findings

### HIGH — CT-1: Gunicorn is neither current nor reproducibly pinned

The Stack table says `>=21.0 current repository constraint; exact image lock required`. That is a brownfield observation, not a target version, and it permits several years of releases. Gunicorn 26.2.0 is the current release as of this review, while 21.0.1 dates to 2023. This conflicts directly with AD-4’s rule that dependencies are reproducibly locked and with the architecture skill’s requirement to verify and bind named technology versions.

**Required fix:** Select an exact Gunicorn target after running the Django test suite and a graceful-shutdown smoke test, then lock it (including hashes in the Python lock artifact). If 26.2.0 is not selected, document the compatibility reason and the update policy. [Gunicorn package release history](https://pypi.org/project/gunicorn/)

### HIGH — CT-2: Docker Engine is a load-bearing but unbound host dependency

The design binds Docker Compose 5.5.0 but omits Docker Engine from the Stack and provisioning contract. Compose health, signal, logging, networking, image-digest pulls, and container lifecycle all depend on the Engine. Current Docker Engine 29.6.2 includes security fixes, so leaving the daemon version to an arbitrary distro package undermines AD-4’s reproducibility and makes host rebuilds divergent.

**Required fix:** Add a supported Docker Engine major/minimum and patch-update policy, state the installation channel, and capture it in host provisioning. A floating “latest” daemon is unnecessary, but the chosen line must receive security updates and be proven compatible with Compose 5.5.0. [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)

### HIGH — CT-3: PostgreSQL 17 target fit is not verified against the actual Heroku source

PostgreSQL 17.11 itself is current, but the repository cannot reveal the Heroku database’s server major, extensions, locale/collation, database size, or restore duration. Those facts decide whether the Heroku exit can use the chosen target and how long the data cutover takes. PostgreSQL officially requires logical dump/restore (or another explicit upgrade technique) across major versions; a data directory is not portable across majors. The spine’s memlog captured this constraint, but the rendered Heroku-exit contract does not.

**Required fix:** Add a pre-cutover discovery/rehearsal gate: inventory source version/extensions/locale/size; use a target-version `pg_dump`/`pg_restore` path; restore into PostgreSQL 17.11; run migrations and integrity checks; measure outage duration; and prohibit source-volume/data-directory reuse. This is compatible with deferring ongoing backups—the migration artifact and rollback plan are still required for the exit. [PostgreSQL upgrading guidance](https://www.postgresql.org/docs/current/upgrading.html), [`pg_dump` compatibility](https://www.postgresql.org/docs/current/app-pgdump.html)

### MEDIUM — CT-4: Python 3.12.12 is an accurate repo pin but not the current security patch

Python 3.12.13 is current and includes security fixes. The Stack wording does permit 3.12 security-patch updates, so this is not a paradigm error, but public cutover should not reproduce the stale `3.12.12` pin. The current Dockerfile also uses floating `python:3.12-slim`, whereas AD-4 requires a locked base-image digest.

**Required fix:** Move the target to Python 3.12.13 (or the then-current supported 3.12 patch), align `.python-version`, and bind the final base image by digest. [Python 3.12.13 changelog](https://docs.python.org/3.12/whatsnew/changelog.html)

### MEDIUM — CT-5: The one-VPS fit and 99.9% target have no capacity evidence

The provider choice is reasonable for minimizing cost, but no Hetzner SKU, memory floor, disk headroom, or simultaneous-slot acceptance test is bound. Blue-green temporarily runs PostgreSQL, Caddy, and two application instances together. Hetzner documents that CX/CPX/CAX plans use shared CPU resources with baseline/burst behavior, so a smallest-instance assumption is not enough to support a 99.9% application target. A single-host 99.9% target is an internal aspiration, not a verified platform guarantee.

**Required fix:** Keep SKU choice out of the durable spine if desired, but add a cutover capacity gate: both slots active under representative traffic, migration and health checks running, no swap/OOM, bounded CPU saturation, adequate disk free space, and a documented vertical-resize trigger. Reword 99.9% as an observed service objective measured externally, not a guaranteed property of this topology. [Hetzner shared-resource FAQ](https://docs.hetzner.com/cloud/servers/faq/)

## Overall assessment

No official evidence contradicts the selected architecture paradigm. Caddy, Docker Compose, Gunicorn, GHCR, Django 5.2 LTS, and PostgreSQL 17 all fit their assigned roles. Apply CT-1 through CT-3 before marking the spine final; CT-4 and CT-5 may be expressed as explicit public-cutover gates if exact operational values belong in the implementation plan rather than the invariant spine.

## Recheck

**PASS — no remaining critical or high findings.** CT-1 through CT-5 are addressed: Gunicorn is bound to 26.2.0 behind compatibility/drain gates; Docker Engine is bound to current 29.7.2 from Docker's stable repository with a patch policy; AD-12 now requires Heroku PostgreSQL discovery and rehearsed logical migration; Python is updated to current 3.12.14 with a digest-pinned base image; and AD-2/AD-9 now bind measurable capacity thresholds, two-slot cutover testing, and 99.9% as an internally measured objective. Official release sources confirm Python 3.12.14, Docker Engine 29.7.2, and Docker Compose 5.5.0 are current on 2026-09-02.

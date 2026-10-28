# Security Policy

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public GitHub issue.

Open a [private vulnerability report](https://github.com/christianaurichzm/aurkad/security/advisories/new)
or email **contact@aurkad.com** with:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if possible),
- the affected version or commit.

You will receive an acknowledgement within a few days. Please allow time for a
fix before any public disclosure.

## Supported versions

Security fixes land on `main` and in the latest release. Older tags are not
backported.

## Scripting trust model: read before hosting

The engine runs game logic (`scripts/` and `modules/`) inside a `node:vm`
context. **This is trusted scripting, not a security sandbox.**

`node:vm` isolates ECMAScript intrinsics but passes real host objects (player,
npc, map) into scripts. Any host object provides a trivial escape:

```js
player.constructor.constructor('return process')()
```

This returns the host realm's `process`. This is a documented, unfixable
limitation of `node:vm` with shared objects.

**Implications:**

- ✅ **Safe (intended use):** run scripts and modules authored by the **server
  owner**, the self-hosted model. This is the supported deployment.
- ❌ **Not safe:** running scripts uploaded by **untrusted third parties** on
  shared infrastructure (multi-tenant / user-generated-content platforms).

Multi-tenant hosting of untrusted scripts is **not** a matter of swapping the VM
library. An in-process isolate is not the boundary: `isolated-vm` is in
maintenance mode and had a Critical advisory in August 2026 in which guest code
reached memory corruption in the host process. The boundary is the operating
system: an ephemeral process or container per world, holding no secrets, with
a minimal disposable filesystem, deny-by-default networking, CPU/memory/PID
limits, a watchdog, and a narrow RPC back into the engine. Blast radius is
part of the design, since one container per group still lets one script
reach another's session.

Runtime handler cost **is** bounded (`SCRIPT_HANDLER_BUDGET_MS`, default 8 ms;
`SCRIPT_HANDLER_BUDGET_STRIKES`, default 5). A handler that repeatedly overruns
is disabled and named in the log and the script editor, and per-handler time and
call counts are published on `/metrics`. What this cannot do is stop a handler
that *never returns*: the tick is single-threaded and JavaScript already running
in the same isolate cannot be interrupted from inside the process. That is the
same reason the list above says what it says.

## Deployment hardening checklist

- Leave `SESSION_SECRET` unset to have the first boot generate one and keep it
  in the database, or set a strong one (`openssl rand -hex 32`) to keep it out
  of the database and its backups.
- Require `CORS_ALLOWED_ORIGINS` in production (enforced).
- Do not expose MongoDB to the public network.
- Run the container as a non-root user (the provided image does; `compose.yml`
  starts it as root only to switch to the owner of its folder).
- Keep dependencies current; `npm audit` is expected to be clean.

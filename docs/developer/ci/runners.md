# 🏃 Runners and caching

Every heavy job lands on `timed-tabs`, a self-hosted Actions Runner Controller scale
set defined in the private-ops repository at `arc/runners/values-timed-tabs.yaml`. The
light one, [Not paused](README.md#pausing-a-pull-request), stays on a hosted runner so
that it answers in seconds.

## The shape of the problem

The runner pod is **short of CPU, not bandwidth**. Downloads finish in seconds;
unpacking them is what costs minutes. That single fact explains every cache in the
workflows:

| What was slow | Measured | What is cached instead |
|---|---|---|
| Unpacking Node | ~2 minutes | The extracted tool directory, so `setup-node` finds it and extracts nothing |
| `apt` + `dpkg` for Firefox's libraries | ~9 minutes on a busy day | A tarball of the installed files, restored with one untar — see [e2e.md](../e2e.md) |

Firefox itself is not cached: fetching and extracting it takes under half a minute,
which is not worth a cache key to get wrong.

## The Node toolchain action

[`.github/actions/node-toolcache`](../../../.github/actions/node-toolcache/action.yml)
wraps `setup-node` with a cache restore in front and a save behind. Three details in
it are load-bearing, and all three are there because of a failure:

- **The key ends in `github.job`.** CI and E2E run at the same time on the same
  commit. On a cold cache both miss, both try to save, and the second loses the race
  with `Unable to reserve cache … another job may be creating this cache`, which every
  run then ends on. A key per job cannot collide, while the shared `restore-keys`
  prefix still hands either job whatever the other one already cached, so nothing is
  unpacked twice. A matrix needs `key-suffix` as well, because every leg of a matrix
  shares one `github.job`.
- **The key carries the OS release**, read from `/etc/os-release`. A tool directory
  built for one image must not be handed to another.
- **The save runs on failure too** (`if: always() && cache-hit != 'true'`), because a
  failing job is exactly when someone is iterating and least wants to pay the unpack
  again.

## Cache scoping

GitHub scopes caches by ref. A pull request's runs save under that PR's merge ref and
read from it and from `main`; a manual run on a branch reads only that branch and
`main`. So the first run on `main` after a cache key changes is a cold one, and every
PR afterwards reads what `main` warmed.

## Action versions

`actions/cache@v5` and its `restore`/`save` halves run on Node 24 and require an
Actions Runner of **2.327.1 or newer**. The scale set reports its version in the
`Set up job` step of any run:

```
Current runner version: '2.335.1'
```

Check that before bumping a Node-runtime action past a major, and keep every action
on a Node 24 runtime — a Node 20 action still runs, but ends every job with a
deprecation annotation.

## Network from the pod

The runner cannot reach the Ubuntu mirrors on port 80 at all: there is no IPv6 route
and IPv4 connections fail. E2E therefore rewrites apt's sources to an HTTPS mirror and
forces IPv4 before installing anything. Without that, the install took nine minutes or
failed outright. The `debconf: delaying package configuration, since apt-utils is not
installed` line that follows is not a problem — it is debconf saying it will configure
packages at the end of the run rather than one at a time.

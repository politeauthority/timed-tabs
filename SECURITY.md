# Security policy

Timed Tabs runs entirely inside the browser. It declares no data collection, talks
to no server, and stores only your settings, rules and per-tab timers in the
browser's extension storage. Even so, a bug in an extension with access to every
site is worth reporting carefully.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
reporting instead:

**https://github.com/politeauthority/timed-tabs/security/advisories/new**

Include what you found, how to reproduce it, and which version or commit you tested.
You will get an acknowledgement within a week, and a fix or a decision within thirty
days. Once a fix is released the advisory is published with credit to you, unless
you would rather stay anonymous.

## Scope

In scope: anything in this repository that ships in the extension, in particular the
content scripts that run in web pages, the handling of rules and site groups, the
backup import, and the release workflows that build the zips.

Out of scope: vulnerabilities in Firefox, Chrome or npm dependencies that only affect
the development tooling and never ship in the extension. Those are welcome as ordinary
issues.

## Supported versions

Only the latest release is supported. Betas are snapshots of `main` and are fixed by
the next beta.

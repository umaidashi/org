# Limited Sandbox credential verification

- Transport RED: one new assertion fails because no stdin injection. Scope module RED: missing module, not semantic scope-failure evidence. Cleanup RED: private synthetic error escapes cleanup, corrected in shared Process boundary.
- Focused DI: 7 pass/0 fail/60ms. Native final: 6 pass/0 fail/41.27s, existing Docker readonly/writable/timeout/cancel/crash lifetime plus explicit child env/metadata absence/known reflection rejection and direct/RPC/automatic daemon CLI.
- Full localcheck: 511 pass/18 skip/0 fail, 529 tests/208 files/183.12s; final static targets366 files; realJev2371subjects143warnings, missing/unsure/review/errors/degraded0. Normal gate skips opt-in Docker; native result separately observed.
- First inspect fixture had too-small output limit, created two unstarted containers before driver returned IDs. Failed timestamps and created/status/user/33s-command matched; only those two IDs removed. Fixture limit corrected, final native success observed. No real credentials used.
- Fresh reviewer C0/I0/M1; optional daemon config fallback can shrink about5 lines, deferred. Same Agent reference must be unique in config; reuse needs explicit different references per Task.
- Known literal reflection only; encoded/transformed/partial secret disclosure and sameUID host isolation are not certified. No public network enabled, no new secret store. Whole goal incomplete.

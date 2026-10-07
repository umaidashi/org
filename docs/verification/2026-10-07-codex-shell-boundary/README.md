# Codex shell boundary verification

- Unit/native fixture: 8 pass/0 fail, 186ms.
- Full local gate: 508 pass/14 skip/0 fail, 522 tests/206 files, 184.12s; static/AST targets nonempty.
- Actual installed codex-cli 0.160.1: baseline read-only permits sentinel command execution; shell_tool=false completes with SHELL_UNAVAILABLE, no command execution/sentinel reflection. Same provider Session resume also completes without command execution. Only non-secret temporary fixtures used.
- Effective features probe: shell_tool=false, unified_exec remains true. Exact [official version source](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/core/src/tools/spec_plan.rs) guards both exec_command and write_stdin registration with ShellTool, hence one operative flag.
- Fresh reviewer C0/I0/M2; docs corrected as planned; single-element test loop simplification deferred, net -4 possible. Other tools, arbitrary binary/version, host principal isolation, actual business API/whole goal not certified.

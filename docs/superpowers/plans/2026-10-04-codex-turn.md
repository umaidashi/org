# Codex turn Adapter境界

Notion06のAgent IdentityとRuntime Session分離を、startとsend/resumeのturn境界へ適用する。Notion再取得は一度transport failure、再試行成功。最終更新2026-10-04T01:51:58.336Zと既存snapshot一致。

- インストール済みcodex exec/resume --helpでstdin/JSONL/config/session引数を確認。
- role/instruction/messageをstdinへ渡し、外部messageをargvのoptionとして解釈させない。
- read-onlyとapproval neverを明示する。これは将来のPermission/Sandbox全体保証ではない。
- 開始時のthread IDと再開対象を分け、JSONL完了イベントなし・error/turn.failed・session mismatchを拒否。
- runProcessは引数として注入し、DB/プロセスなしの最小UTで出力契約を検証。

初回UT RED→実装→全検査/実jev/独立レビュー。実Codexモデルの操作、Claude Adapter、AgentRuntime start/send/resume/stop全体、Session永続化とTask統合は後続で検証する。UTのfixtureは実サービス成功の証拠として扱わない。

JSONL schemaの参照： https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs

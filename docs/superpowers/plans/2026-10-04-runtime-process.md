# Runtimeのプロセス実行境界

Notion「06｜Runtime Ports｜Agent・Sandbox・Workflow」を再取得し、最終更新2026-10-04T01:51:58.336Zとsnapshot一致を確認。Agent IdentityとRuntime Sessionを分離し、start/send/resume/stopに進む前に実行境界を作る。

1. 実Bun子プロセスの明示入力・環境・終了コード、timeout/cancel/出力上限をテストしてREDを確認。
2. shellを経由せずargvで起動。envを明示注入し暗黙の資格情報継承を避ける。stdout/stderrは共有byte上限、停止時は直接childを終了しawaitする。
3. 全suite・静的検査・実jev・独立レビューを実行して記録。

この段階の完了はプロセス実行境界のみ。Codex/Claude adapters、Session永続化、Task連携、子孫プロセス群のSandbox隔離、Permission/Approvalは続く実装範囲。外部AIへの実送信や任意ユーザーコマンドのCLI公開は行わない。

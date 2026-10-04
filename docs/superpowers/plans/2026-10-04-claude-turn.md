# Claude turn Adapter

Notion06を再取得し最終更新2026-10-04T01:51:58.336Zとsnapshot一致を確認。start/send/resumeへ向け、Codexと同じRuntimeTurnInput/Resultを共通Portへ移す。Agent Identityとprovider sessionを分離する。

- ローカルClaude helpと公式headless docsでprint/stdin/JSON/session/system promptを確認。
- bare modeでhooks/plugins/自動MCP読込を避け、toolsを空にする。ツールを許可する正式なPermission/Sandboxは後続実装。bare modeではAPI環境資格情報が必要で、subscription loginを暗黙使用しない。
- role/instructionをsystem prompt、messageをstdinへ渡す。resumeは明示sessionのみで、optionに解釈されるIDを拒否する。
- result/success/is_error/session/textの形状とsession一致を検証。process timeout/cancel/非ゼロは成功にしない。
- DB-free UT RED→GREEN、全suite、実jev、独立レビューを記録。fixture/DI成功は実Claudeサービス成功とは扱わない。

Claude資料: https://code.claude.com/docs/en/headless
Session永続化・Task/Room接続・実モデルe2e・start/send/resume/stop全体は未完了として継続する。

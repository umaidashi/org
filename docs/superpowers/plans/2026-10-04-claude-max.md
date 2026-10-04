# Claude Maxの認証でRuntimeを実行

ユーザー指摘：Claude Maxのログインを使う想定。bareによりAPIキーだけを要求した実装を訂正する。auth statusの非秘密フィールドでclaude.ai / max / loggedInを確認済み。

1. Claude commandのUTをbareなし/safe-modeありへ変更しRED確認。
2. safe-modeでカスタムCLAUDE.md/skills/plugins/hooks/MCP/auto memoryをロードしない。tools無効、slash commands無効、disableAllHooks設定、strict empty MCPを指定する。管理policyはClaude Code側の優先規則に従う。provider Session resumeは維持する。
3. APIキーを渡さずHOME/PATHなど必要な環境名だけ選択し、実Claude Maxを実daemonからstart/resume/Room reply/Task結果まで検証。raw認証・応答・pathは公開ログへ載せない。全回帰と実Jev、独立レビューを記録する。

[公式認証](https://code.claude.com/docs/en/authentication)、[safe-mode仕様](https://code.claude.com/docs/en/cli-reference)。safe-modeは認証を維持するが、managed policy settings（policy hooksを含む）は適用される。これはsandboxではなく、一般のOS隔離・外部操作Permissionは後続。

Review Focus: Max認証をAPIへ勝手に切り替えない、ユーザーのcustom hooks/MCPが起動しない、役割/指示をresumeでも更新、keysをargv・ログに載せない。

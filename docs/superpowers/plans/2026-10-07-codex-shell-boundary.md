# Codex Runtimeからhost shell実行を外す

Notion08の実行境界/capabilityと現実callerの差。Claudeはtools空で起動するが、Codexはread-only sandbox/approval neverだけでshell_tool/unified_execが有効。read-onlyはshell起動拒否と同じではない。コード実行は既存の権限付きSandboxで行うため、Runtimeはhost shellを起動しないnative設定にする。

1. 既存codexCommandの最小UTでstart/resume両方へshell_tool/unified_exec falseが明示されることをRED。呼出driver/fixtureのargvも照合し、文字列grepだけの完成にしない。
2. 現在インストール済みCodexのfeatures listで両stable flagを確認済み。公式[configuration reference](https://developers.openai.com/codex/config-reference/)に従い既存-cへfeatures.shell_tool=falseとfeatures.unified_exec=falseを追加。独自Runtime/provider/Prompt依存/新wrapperは不要。web_searchや全外部toolの無条件保証をこの2flagから推論しない。
3. real CLI fixtureでstart/resume指示伝達を確認。実Codexのnative設定受理と可能なら非機密temporary sentinelに対するshell不可/通常reply継続を最小e2eで観測し、ログイン/認証/ネットワーク不能は別の未検証として記録。実key/auth cacheを保存しない。
4. fullgate/actual Jev/fresh whole-unit reviewer一回/Ponytail・証拠・README・要件・ログ・Git/main通常push。その他tool/resource permissions・限定credential・重要Audit inventory・実配送/業務受け入れは未達のまま次単位へ進む。

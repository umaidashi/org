# Sandboxへの限定credential注入

Notion06/08の未完了項目。現在Dockerへ秘密を渡す経路はない。既存SecretStore、Sandboxのowner/capability/version検査、Process DI、Docker隔離を再利用する。秘密の値をSandboxInput/Policy/Audit/argv/Artifactに含めない。

1. 実callerはsandbox CLIとdaemonの二つ。host明示policyにAgent・Task・target environment名・SecretStore referenceの有限grantだけを置く。未知field/重複/予約envを先行拒否し、grantなしは従来経路。任意Taskや別Agentへ流用できないことをRED。
2. 既存serviceの共有境界でTask running version/owner/Agent capabilityを秘密取得前と取得後に再照合。SecretStoreは既存Environment Adapterを配線し、host環境全体のfallbackコピーを禁止。取得失敗/権限変更はDocker実行・成果物保存ゼロ。
3. Docker実行childへstdin経由で限定envを渡す。create/exec argvとinspect可能なcontainer設定には値を置かない。一時ファイルへ秘密を保存せず、既存non-root/network-none/read-only/timeout/cancel/finally cleanupを維持。
4. stdout/stderr/収集fileのdecoded bytesに既知秘密が反射したら固定エラーでArtifact保存を拒否。未知/transformed secretと外部認証の一般保証は主張しない。秘密不要な安全な成果物の成功も対照検証。
5. 最小DI RED/GREEN、actual CLI fixture、実Dockerの注入・他env不在・metadata非露出・反射拒否・cleanupを確認。全localcheck、非空dry-run、許可済み実Jev、fresh unit review一回。docs/work-log/requirements/README/証拠/Git/main通常push。

新Vault、credential保管DB、Docker reuse、network許可、汎用policy engineは作らない。実API/業務Issue指定は別の受入条件として保持する。

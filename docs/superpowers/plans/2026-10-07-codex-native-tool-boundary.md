# Codex native toolとCore境界

ShellToolだけでは全native toolが外れない。installed0.160.1のview_image/apps/plugins/multi_agent/hooksは既定有効（hooksのkeyは公式feature registryで確認）。ViewImage登録はShellToolとは別guard。RuntimeはCoreのscope付きContext・typed A2A・承認済み外部操作・Sandboxを使うため、native直接経路を既存CLI設定で外す。

1. 公式対応版sourceとinstalled effective flagsで各操作の登録/実行条件を確認。現実のdefault facilityだけを対象にし、未知tool/任意binary/managed-policyの保証を推論しない。
2. shared codexCommand start/resumeのnative overrideへview_image/hooks/apps/plugins/multi_agent falseとweb_search disabledを明示する最小UTをRED。既存ShellTool false/read-only/approval never/ignore-user-configを保持。未知flag名を推測せず、受理だけでは実禁止を認定しない。
3. 非機密一時image/hook sentinelで必要なpositive対照とdisable時の不可/通常replyを観測し、fixture start/resume/stopと全localgate/実Jevを確認。新provider/tool engine/loggerは作らない。実認証/実APIとnative builtinの範囲を分ける。
4. fresh unit review一回、指摘はuser effectで再gradeして一回fixpass、Minors ledger。証拠/docs/work-log/README/requirements/監査/Git/main通常push。

Agent.permissionsの具体データモデルと重要操作inventoryはこれと別に未達。stable flagの存在だけで全体完成とはしない。

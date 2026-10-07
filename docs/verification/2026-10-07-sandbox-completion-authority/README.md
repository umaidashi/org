# Sandbox完了権限の再照合

共有runGrantedSandboxで非同期Docker完了後、現在のAgent capability/Task owner/version/statusを再照合してから返す。既存両callerとguardを再利用し、productionは3行の変更。送信済みcredential/既に実行済みcodeの回収、後続保存との原子性は保証しない。

- UT変更前1成功1失敗→変更後2成功0失敗30ms。capability/owner/version変更と安全対照を検証。
- 実Docker+CLI direct/RPC: container内のowned marker確認後human Approvalでcan_run_shellを撤回、Task failed/Artifact recordとbytesゼロ/Audit failed・成功なし/container削除を検証。既存注入成功3ケースも含め5成功10.96秒。
- 初回native3成功2失敗はAudit投影outputRefをnullと誤期待。実契約はfailed Event URIであり、productを変えずfixture修正。nativeの非ゼロだけではtimeout等の別原因を排除しないというMinorを残す。UTは権限エラーを直接照合する。
- final full513成功21skip0失敗534tests209files182.90秒、type/Oxlint/Oxfmt366files/非空AST/dry-run成功。実Jev2382subjects145warnings、missing/unsure/review/errors/degraded0。抽象warningで追加実装しない。
- fresh reviewer C0/I0/M1、独立UT2成功。Minorはnative stderr原因のassert追加。default defer、再レビューなし。Ponytail Lean/net0。

全体は未達。次は[重要操作棚卸し](../../important-operation-audit-inventory.md)のAgent構成操作を検証する。

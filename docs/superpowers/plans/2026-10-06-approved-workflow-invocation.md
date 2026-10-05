# 承認済みWorkflowのnative実行

直前の不変ApprovalをCLIのnative呼出しに接続する。host設定のWorkflowにeffect(read_only/write/irreversible)を付け、省略は既存read_only契約として扱う。write/irreversibleは同じhost・Workflow・input digest・stable invocation ID・effect・要求actorに対する人間approveが必要。実行直前に照合し、既存先行claimで一回だけ呼ぶ。失敗/不明結果もclaimを保持し再送しない。

CLI request-approvalで実行と同じ引数からdigest/IDを生成し、既存Approvalへ保存する。runの--approval/--actorで照合する。read_only Agent scopeへwrite Workflowを登録できず、自動Event配送からもwrite/irreversibleを除外する。既存read_only CLIは互換を維持する。

RED→pure照合UT→native HTTP fixtureと実CLI request/decide/run/no replay/mismatch→全check/実Jev→branch最終レビュー。実n8n参照Workflowだけをwrite契約として宣言して人間承認経路を別検証し、業務サービスへ書き込まない。

未完了: Agent Taskによるwrite承認待ち/再開、長時間Workflow、認証、重要操作全種。host effect宣言はn8n node副作用の自動検出ではない。

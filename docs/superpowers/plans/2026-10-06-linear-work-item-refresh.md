# 既存Linear WorkItemの明示refresh

Notion Task抽象化を再取得しWorkItem同期/内部Execution分離を確認。既存固定GraphQL readerとTaskProvider get/update(expectedVersion)を使い、`task refresh-linear LOCAL_TASK_ID --expected-version N`でtitle/objectiveだけを取り込む。新queue/table/remote mutationなし。

Ruling: 自動双方向同期ではなくlocal adminの明示置換。指定versionのtitle/objectiveはremote値に置換する（ローカル編集も対象）。status/owner/labels/dependency/Artifact/内部Executionは変更しない。source URLが変わった場合は出典を混ぜず拒否。fetch前のversion/WorkItem/Linear ID確認と保存時CASで競合を拒否。同値は更新しないがfetch後にもversion再確認する。

1. DI UTと実CLI未対応RED。
2. 既存TaskProvider/readerに最小service/CLIを接続、同値とfetch中競合、identity/read障害を確認。
3. native direct/daemon HTTP fixture refresh→履歴→再open/内部Task保持、全check/実jev、独立review一回・Important一fixpass、Git/main push。

Review Focus: URL変更は拒否、version競合時no-opも拒否、vendor ID入力はローカルTask IDのみ。実APIはkey未設定につき未検証。明示置換はlocal編集を消すためCLIのversion指定とREADMEで明記する。

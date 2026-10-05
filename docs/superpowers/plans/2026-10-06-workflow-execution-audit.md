# Workflow実行receiptのAudit投影

既存の不変workflow Eventを正本として、native caller actor(kind/id)、Task/Event参照、Approval、入力hash参照、開始execution参照、観測結果をaudit listへ投影する。生入力・APIキーを追加保存しない。unknown invokeはfailedと断定せずunconfirmedとして出す。host callerはsystem:host:workflowであり人間本人認証ではない。actor情報がない過去receiptは勝手に人物を補完しない。

RED: receiptのAudit projection moduleとCLI表示が未対応。GREEN: pure projection/context照合/同時刻因果順/実CLI承認→native実行→Audit。全check・実Jevとbranch最終レビューを実施する。

native status/cancel観測も新規不変Eventから投影する。長時間Workflow、Agent write承認待ち、RPC認証など全体要件の未完了は別途継続する。

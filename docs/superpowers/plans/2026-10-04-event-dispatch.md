# EventからTaskへの再実行可能な処理

Notion「07｜Local-first CLI / TUI」を再取得し最終更新2026-10-04T01:51:58.336Zと照合した。daemonはpolling、process管理、retry/timeout、local APIを担う。ここでは最初に`org daemon --once`と配信履歴を実装し、再起動後も同じEvent/SubscriptionからTaskを重複作成しないことを証明する。常駐/socket/runtimeは後続で追加する。

Ruling: 現在有効なSubscriptionを既存Eventにも照合するbackfill方式。Agent購読ごとに内部ExecutionTaskを1つ作成し割り当てる。Workflow購読は未実装であることをdeferred状態として保存・表示する。Task実行の完了とは扱わない。

配信keyはEvent IDとSubscription IDの長さ付き連結で一意にする。Task IDも同じkeyから決定し、初回入力/時刻はEvent原本から決定する。Task Adapterがpending作成とassigned履歴を一つのBEGIN IMMEDIATE内で保存する新Portを提供する。重複呼出しは元の不変履歴と入力/ownerを照合し、現在のTaskを返すだけで再割当しない。不一致ID衝突は拒否する。

Ruling: Task保存と配信receiptは別モジュールの別トランザクションとする。Task成功後receipt保存前に落ちても、再試行が同じTaskを返すことで復旧する。Daemon AdapterからTask SQLを触らない。これは原子的な横断commitを主張する設計ではなく、冪等な復旧の設計である。

1. 別CLI publish→購読→daemon once→assigned Task→再実行→1Task/同履歴の未実装RED。
2. Taskの原子的createAssignedOnce Portを先に実DBテストし、割当履歴保存失敗の全rollback、同ID不一致拒否、進んだTaskの再割当なしを確認する。
3. 純粋な配信計画と最小PortのDIをUTで検証し、receipt失敗後復旧をintegrationで確認する。
4. concurrent CLI daemon onceでもTask1件になるe2e、全検査/実jev/独立レビュー/ログを記録する。

一般の外部副作用に対するexactly-onceは主張しない。今の受信操作はTask作成と割当だけ。Runtime/Workflowの外部副作用は別のidempotency契約を必要とする。

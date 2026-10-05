# 委譲Taskの人間レビューをCoordinatorへ返す

- 既存TaskReview原本とTask historyを公開Portで読み、承認待ちsnapshot/レビュー後snapshot/成果物/ownerを照合する。
- 元delegateへの逆向きtyped decisionとして返す。これはowner Agentが記録済み人間reviewを報告するMessageで、Agentによる承認ではない。
- review IDから決定的Message IDを作り、同原本は再起動/次tickで重複しない。送信失敗ではレビューを失わず送信だけ再試行。既存Room archived延期/activation/correlationを再利用する。
- 純粋/DI最小UTの未export RED→GREEN。実daemonでdelegate→実行→result→human review→decision→Coordinator通知→再起動重複なしを確認。
- 詳細外部Approval/本人認証は追加しない。Room/Task全scanは既存規模のまま、測定で必要なら絞込を追加する。

# 常駐daemonとローカルsocket

Notion「07｜Local-first CLI / TUI」を再取得し、最終更新2026-10-04T01:51:58.336Zと照合。`org daemon`を常駐させ、Event pollingとUnix socket APIを提供する。

受け入れ条件：別CLIからstatus/dispatch/stopへ接続できる。起動後にpublishしたEventを定期pollingでTaskへ変換。SIGTERMまたはstopで接続/DB/timer/socketを解放。同socketの2重起動と既存ファイル置換を拒否。停止後再起動して同じTaskが増えない。poll失敗はhealthをdegradedにして次回pollで復旧する。

Ruling: Bun native HTTP over Unix socketを使う。TCP listenerは開かない。socketは0600、作成時umask077、隣接lock directoryでorg同士の2重bindを防ぐ。既存socket/file/lockは自動削除しない。終了時は自分が作ったinodeだけを削除する。SIGKILL後のstale socket/lockは利用者による確認後の手動整理が必要。

APIはGET /v1/status、GET /v1/deliveries、POST /v1/dispatch、POST /v1/stop。Origin付きリクエストを拒否し、任意shellやファイル操作は公開しない。CLI clientは5秒でtimeout。daemon --onceと従来のdeliveries直読を維持し、--socket付きdeliveriesはdaemon経由とする。

1. 別プロセスの起動→接続→新Event→poll→停止→再起動の未実装RED。
2. 注入したdispatch/receipt操作でpollエラーと復旧を検証する。
3. Unix socket権限・2重起動・ファイル保護・signal cleanupを実プロセスで検証。
4. 全検査・実jev・独立レビューとログを記録する。

全CLIをdaemon clientへ移す作業、Runtime process管理、scheduler、Execution retry/timeoutは引き続き未完了。参照： https://bun.sh/docs/runtime/http/server 、 https://bun.sh/guides/http/fetch-unix 。現在固定のBun 1.3.4で実際に動作を検証する。

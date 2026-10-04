# 業務CLIのdaemon client化

Notion「07｜Local-first CLI / TUI」の再取得が一度transport failureになったが再取得に成功し、最終更新2026-10-04T01:51:58.336Zと照合した。「CLIとTUIはdaemonへ接続する薄いclient」を現在実装済みのAgent/Task/Room/Event CLIへ適用する。

通常のCLIはdaemonへ接続し、接続失敗時にDBを勝手に作らない。従来の直接DB操作は明示的--direct管理モードで維持する。--dbはclientの既定socketを選ぶ。明示的--socketはそのdaemonを選ぶ。remote commandがdaemonのDBを変更することは許可しない。

POST /v1/commandにargvを渡す。受け付けるのはAgent/Task/Room/Eventの既存コマンドのみ。JSON形状/引数数/長さを検証し、server側でも同じparserで検証する。db/socket/direct/daemon等の管理指定はremote bodyで拒否する。任意shellは実行しない。

Ruling: 既存CLI parserとmoduleの起動配線をapplication境界へ移し、出力関数を注入してstdoutを構造化収集する。APIはcode/stdout/stderrを返し、clientは形状を検証して既存の出力/終了0・1・2を維持する。共有consoleの一時差し替えや子CLI起動はしない。

1. daemon起動→通常CLIでAgent/Task/Room/Event操作→別client読込、未起動時にDBを作らないRED。
2. transport flags/parserとcommand envelopeの境界UTをRED→GREEN。
3. 元のe2eは--directの管理操作として維持し、daemon経由のe2eも追加。remote DB変更拒否と不正body、usage/業務失敗の契約を検証。
4. 全検査・実jev・独立レビュー、READMEとログを記録する。

TUIと未実装領域のclientはそれぞれの実装時に追加する。Runtime実行や他のNotion領域の完了は主張しない。

Ruling: 既定socketはDB絶対パスに.sockを付ける。同じディレクトリの別DBへ誤書込する旧org.sock方式を廃止し、server/clientで同じ導出関数を使う。既存利用者はdaemonを停止して再起動するか明示的--socketを指定する。

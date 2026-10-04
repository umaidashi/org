# daemon経由のSession CLI

Session start/send/resume/stop/get/list/historyを通常のdaemon commandとして公開し、--direct実行は拒否する。remote bodyは引き続きDB/transport/daemon設定を変更できない。

Daemon起動側だけが--runtime-config PATHを指定できる。JSONはcodex/claude別に絶対executable/cwd、env名リスト、timeout/output上限を定義する。資格情報の値をJSONへ保存せず、指定env名のみdaemon環境から注入する。未設定driverは明示的に失敗する。API clientは実行file/cwd/envを変更できない。

command handlerとcloseをasync化。stop/SIGTERMではRuntime shutdownを先に行い、HTTP待機中turnをcancel/drainしてからserverを停止する。startup lock取得後にrunning状態の復旧を配線する。

Parser未実装RED、実CLI/daemon/SQLite/fixture executableの開始→resume→stop→再起動e2eをRED→GREEN。全suite/実jev/独立レビューとREADME/要件/ログを記録する。実AI providerのe2eは別途実行しfixtureとは区別する。

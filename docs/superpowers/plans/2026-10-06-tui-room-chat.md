# TUIからRoomへ明示入力

根拠: docs/requirements.md のTUI対話と不変Room Message。`org tui --room ID --human ID` はdaemon専用の対話mode。指定humanがactive Room参加者であることを公開getで確認し、履歴の末尾20件を表示。入力された一行をroom sendの公開操作へ一度だけ渡す。空行と/refreshは読取、/quit・Ctrl-C・EOF終了。Agentの起動は既存daemon opt-in activationだけが担当し、TUIがRuntimeや別の書込を追加しない。

1. parseとRoom参加者検証、literal入力の一回送信、failure/no retryを注入Port UTでRED確認。
2. native readlineを接続し、エラー/終了でinterfaceとlistenerを解放。画面に出す本文の制御文字除去と上限を実装。
3. 実PTYの日本語入力→daemon原本Message→再読込と/quit/Ctrl-Cを確認。全check・実jev・最終review・記録・通常main push。

Human IDは既存の宣言的ローカルidentityであり本人認証ではない。自動refresh/streaming、Task操作は別の未完了項目。

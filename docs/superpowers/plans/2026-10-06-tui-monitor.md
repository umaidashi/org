# daemonの読取TUI監視

根拠: docs/requirements.md のTUI Agent/Room/Task/Event監視。既存requestApplicationの公開listを再利用する。`org tui` はdaemon専用、stdin/stdout TTY必須。1秒間隔の読取、r更新、q/Ctrl-C終了、resize再描画。業務書込やRuntime起動をしない。

1. 注入されたCommand読取Portで4種類を取得するUT、未知shape/制御文字/表示上限のUTをRED確認。
2. node:readlineと既存Unix socket clientを薄く接続。raw modeとlistener/timerはfinallyで復元。接続失敗は非ゼロで伝える。JSON本文を表示せずID/name/title/type/statusのみを表示し、端末制御文字を除去する。
3. 実PTYの日本語表示、resize、q/Ctrl-C、daemon不在を検証。型検査・全check・実jev・最終独立レビュー・記録・通常main push。

全体の対話TUI、会話入力、操作Approvalは別の未完了項目。新しいUI依存やDB直接読取は追加しない。

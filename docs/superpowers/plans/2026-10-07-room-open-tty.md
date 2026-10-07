# Room open aliasと実TTY受け入れ

Notion07の`org room open`を既存Room chatへ接続する。新しいChat/Monitor engineや人間identityの自動推測を作らない。

1. parser/非TTY CLIで`room open ROOM_ID --human HUMAN_ID`のREDを確認する。human指定/Room参加者確認は既存chat境界を保ち、未知option/余剰target/directを拒否する。
2. 既存parseTuiCommand/runRoomChatへaliasだけ配線。既存`org tui --room ID --human ID`を維持し、Room titleをIDと装う検索は追加しない。Notionの名前例は安定ID指定で操作する。
3. 本物のPTYでMonitor Agents/Rooms/Tasks/Events表示、r refresh/q終了、Room chat初期表示/メッセージ送信/refresh/quitとCtrl-Cを確かめる。実Room原本の保存/再openも確認し、単なる非TTY拒否やmock callbacksだけで実対話完成を宣言しない。fixtureは一時DB/socketと公開可能なsynthetic dataだけを使用。
4. 指針/リファレンス/Ponytail/full local gates/実Jev/一回fresh review/証拠/ログ/Gitを維持。sender宣言と本人認証、監視UIと業務受け入れを区別する。

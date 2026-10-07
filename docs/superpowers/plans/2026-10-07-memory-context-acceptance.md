# Memory scope関連付けの残る実CLI受け入れ

前単位のfresh reviewで、manual Session以外の直接証拠不足をMinorとして追跡。新しい機能を足す前に実CLI受け入れを補う。

1. 保存済みSessionのresume/rebuild後のRoom返信、Task実行、Room自動wake-upでhost scopeが実Runtimeへ渡ることを確認する。同じfixture Driverを使いdepartment/project ID一覧を応答へ返し、除外/原本保存をassertする。
2. 存在しないAgent、非参加Agent、archived Roomのgrantでdaemon起動が失敗し、runtime未実行、socket/lease cleanup、修正設定で再起動できることを確認する。
3. 製品変更なしなら既存実装の追加受け入れとして記録する。不具合なら実CLI REDを保存し根本callerを一度だけ修正、型/全gate/実Jev/fresh review/Ponytailへ進める。狭いmanual fixtureから全経路完成を推測しない。

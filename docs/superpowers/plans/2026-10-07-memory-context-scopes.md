# department/project Memoryを現在Contextへ関連付ける

Notion03は現在scopeだけをretrieveする。既存Runtime ContextはRoom/Agent/Task/company/globalを選択し、department/projectの保存・検索はできるが現在Sessionへの関連がない。組織directoryや自動所属推定を増やさず、hostがRoomとAgentの組を明示する。

1. 実daemon Runtime fixtureで、host指定のdepartment/project Memoryだけが送信Contextへ入るRED。別Room/別Agent/別department/projectとinactive/expiredを除外し、再起動・既存設定なしの互換を確認する。
2. `daemon --memory-context-config PATH`を連続runtime-configモードだけで受け付ける。最大64KiB JSON配列、各要素は厳密な`{roomId,agentId,scopes}`（最大32組、各最大32件）。scopeはdepartment:ID/project:IDのみ、重複pair/scope・空白/NUL/過大ID・未知fieldを拒否する。設定はhostが所有しmodel/RPCで追加しない。
3. 起動時に公開Room/Agent readerで存在・参加関係・activeを照合。現在SessionのRoom+Agentに完全一致したscopeだけを既存retriever/builderへ渡す。既存Runtime reply三経路を一つのlocal wrapperへまとめて取りこぼしと重複を減らす。新DB/DDL/DI container/所属directoryは作らない。
4. identity宣言と本人認証を区別し、host関連付けは人物所属/全権限体系の保証ではないことを記録。再構築/Task/自動wake-upの現Contextは同じ経路で検査する。
5. RED/GREEN、静的/全gate/実Jev、一回fresh全単位review/Ponytail、証拠・ログ・Git。全source自動抽出/一般認証/実業務納品の残件は維持する。

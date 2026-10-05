# Typed delegateからExecutionTaskへ

Notion01/04/09の委譲とTask実行を既存typed A2A・can_delegate・createAssignedOnce・pollExecutionTasksで接続する。新規queue/table/CLIは作らない。

1. delegateA2ATaskをDI/TDD。Room内の検証済みdelegate原本/送信元grant/両Agent/Task参照/非archive/別Agentを確認。payload全体をTask objectiveへ含め、宛先owner・参照Taskをparent・source URI externalRefへ保存。Message IDをnamespaced Task IDとして既存createAssignedOnceで二重作成/advanced Task再割当を防ぐ。
2. daemon共通activateでdelegateをこの操作へ分岐。普通のRoom Runtime turnを実行せず、Task自動workerで既存Context/Memory/Runtime/成果物/承認待ちへ進める。手動activateは割当まで、--wake-upなら実行まで。intent completedは委譲Task作成の完了でありTask成果の完了ではない。
3. DB不要UTと実daemon e2eでChief→専門Agent delegate→1Task/1turn/成果物→明示レビュー、再起動no replay、権限なし/不正参照拒否。全検査/実Jev/独立レビュー→commit/main。

Ruling: Notion payload schema未指定のためJSON全体を指示の一部として渡す。任意追加fieldを独自仕様にしない。Task結果のtyped result返信は次の専用変更。costは委譲結果を現時点ではTask/Artifactで参照すること。
Review Focus: 宛先とowner、grant迂回、source/parent整合、Task ID collision/idempotent conflict、既存advanced状態保持、ordinary Room turn二重発行なし、失敗/停止/restart、結果の自動承認なし。

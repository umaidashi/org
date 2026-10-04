# Room Activationの選択

Notion01/02を再確認。人間発言で全Agentを起動せず、coordinatorを既定とし、明示mentionとtyped A2A宛先を優先する。既存Room/Message原本を再利用する。

1. Roomにoptional coordinatorIdを追加。参加Agent以外は拒否、旧JSONでは省略して互換維持。単一Agent RoomはそのAgentをcoordinatorとして判断し、複数Agentでは明示指定を必要とする。JSON保存のため新table/migrationを作らない。
2. 純粋selectActivationAgents(Room, Message)をTDD。metadata.mentionsはAgent ID配列とし、Message保存境界で参加Agent/非空/型を検証。明示mention/A2A toを優先、coordinator/mention_only/allを選択。sender自身は対象外。通常Agent返信は次の発火源にしない。archive/別Room/非参加sender/不正metadataは拒否。
3. CLI room create --coordinator、room send --mention（複数可）、room targets ROOM --message IDで決定を観測。実daemon/SQLite→再open、旧JSON、誤参照、archiveを検証。全検査/実Jev/独立レビュー→commit。

Ruling: rule_basedの構文はNotion未指定であり、この段階では明示宛先を処理し、未指定は未対応error。任意コードや推測rule engineを作らない。既存全policyの保存互換を維持し、ルール設定/評価は後続の別計画で満たす。

Review Focus: 全Agentの暗黙起動を避ける、参加者/原本一致、明示宛先の検証、返信loopを止める、旧JSON保存互換。targetsは選択だけでRuntimeの起動/副作用は行わない。次段階で選択結果をdurable wake-up/Session返信へ結線する。

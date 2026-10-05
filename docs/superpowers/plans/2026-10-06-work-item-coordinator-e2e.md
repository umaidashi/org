# WorkItemからCoordinatorのコード実装へ

既存Task Room/A2A parentId/Linear読取importを再利用する検証追加。新product abstraction/queue/toolなし。native fixtureは旧Group RoomとWorkItem Task Room、manual/automatic両方を保持する。実Claudeコードproofでは固定公開HTTP fixtureの既存Linear IssueをWorkItemへ取込み、Task RoomのChiefから専門Executionへparentリンクを保ち、実Docker/生成物check/review/Memory/restartを確認する。

Ruling: Linear応答はHTTP fixture、Claude MaxとDocker/生成物品質gateは実物。実Linear認証/業務Issue/変更先repo/Draft PRは未完了。同じproofへ接続し、2Agentコードproofを増殖しない。WorkItemの状態/原本/historyと初回importを内部処理が変更しないことをassertする。

1. native未連結RoomのparentId欠落をRED確認。
2. 既存Task Roomへ結線してnative旧Group/新WorkItem両mode、real codeproofのsourceをLinear importへ変更。
3. 実Claudeコードe2e/旧算術回帰/全check/実jev/独立review一回、Important一fixpass、Git/main push。

Review Focus: fixtureを実Linear API成功と表記しない、read credentialがRuntimeへ渡らない、内部Executionのparent/外部出典混同なし、WorkItem原本/進捗不変、旧Group/算術proof保持、取得生成testとisolated bun checkの非空性維持。

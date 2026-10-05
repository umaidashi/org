# 長いWorkflowの読取継続

根拠: docs/requirements.md のWorkflow resume/long-running。外部invokeが既に開始・検証され、不確定観測receiptを保存した場合はTaskをblockedとする。実行失敗・invoke不確定（startedなし）はfailedのまま。再起動はblockedを保持し自動invokeしない。

1. hostのtaskWaitTimeoutMs（50..30000ms、default30000）で短いnative観測窓を設定。観測不確定の専用TaskResultPendingError→blockedをRED/GREEN。
2. daemon専用`task observe-workflow ID --expected-version N`はcurrent blocked/直前running snapshot/owner/Room原本Message/安定claim/started/unconfirmed/host/effect/scope/現在capability/dependencyを照合。writeは元human Approval原本も再確認。専用credential lookup後再照合→CAS running→status GETだけ→verified Artifact→結果待機。まだpendingならblocked、確定失敗ならfailed。invokeは呼ばない。
3. 原本claim/Approval/Messageを保持。unknownの再観測は元unconfirmedを保持し、terminal observationは安定IDで追加。Task stateと原本更新は既存所有者を維持。
4. DBなしUTと実daemon/Runtime/HTTP一周（遅いstatus→再起動→観測→invoke件数維持）。全check・実jev・独立review・公開記録・通常main push。

長い外部実行の自動poll/retry/再起動復旧全般やArtifact保存失敗の回復は別要件。API status読取の継続は外部処理の再実行ではない。

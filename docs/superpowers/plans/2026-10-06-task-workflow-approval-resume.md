# Agent Workflowの承認待ちと一回の再開

根拠: docs/requirements.md のAgent write承認待ち/再開。hostが明示したwrite/irreversible Agent scopeだけを追加する。read_only Agent runtime factoryは従来どおりwriteを拒否。

1. Runtimeのwrite提案は現在running Task/version/原本Message/5capabilityを検証し、Task-bound Approval要求を保存する。外部操作・Agent credential lookupなしでTaskをwaiting_approvalへ更新（outputArtifactなし、結果review不可）。
2. daemon専用`task resume-workflow ID --approval ID --expected-version N`。human approve・同Task/owner/元running version/immutable proposal・current waiting snapshot・host/effect/Agent allowlist/現在capability/dependencyを再照合。Agent専用credentialをlookupし、再照合後CASでrunning。安定claim先行で一度だけnative invoke→verified status→hash artifact→結果waiting_approval。
3. pending/rejected/mismatch/stale/duplicateは非呼出し。restartでoperation waitingとApprovalを保持し、autonomyは再実行しない。失敗/停止はfailedとunconfirmed、native外部再試行なし。original history/Approval/Messageを保持。
4. DBなしUT・実daemon/Runtime fixture/Workflow HTTPで小さな一周。全check・実jev・最終独立レビュー・公開記録・main通常push。

write effectは信頼済みhost宣言でありn8n node内容を検査しない。Human本人認証・完全process隔離・長時間Workflowの継続観測/自動再開は別の未完了要件。ApprovalとTaskは別所有者の保存であり、要求後Task更新が失敗すると要求が残るが外部操作は行わない。原子的と主張しない。

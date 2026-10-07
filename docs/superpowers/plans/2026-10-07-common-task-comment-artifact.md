# 共通Taskのcomment/artifact実consumer

[共通write計画](2026-10-07-core-provider-writes.md)の残二操作。更新単位の最終検証・公開後に着手する。既存Local保存とLinear human Approval/claim/receipt/観測を再利用し、新mutation engineや背景同期を作らない。

1. addCommentをAsyncTaskProviderとawait consumerへ実接続する。actor/version/Approvalを明示contextとし、CoreはTaskCommentを扱う。Localは原本保存、Linearは既存外部comment承認対象とCore入力の対応を明示する。コメントID/body/actorの一致をcredential前に検査し、返却形は原本とreceipt参照を区別する。不要な外部送信とLocalの隠れたstageを行わない。
2. linkArtifactはLocal input/output stageと、確定済みoutput原本の外部リンクを可視操作として分ける。外部承認があるときは既存artifact ID/URI/version/titleを照合し、methodがwrite後にLocal stage失敗を隠さない。LocalとLinearの共通入力・結果の意味を先に設計する。
3. 実CLI/native daemonのREDから小さく進める。未承認/原本変更/actor不一致/unsupported inputは送信ゼロ、承認後一回、保存障害・応答不明・再送禁止・observe/reopenを検証する。Core→両Adapterの実await consumerを確認し、個別legacy commandだけで六操作完成としない。
4. 指針/リファレンス/Ponytail-review、全local gate・実Jev・一回fresh final reviewを適用し、結果をwork-log/verificationに保存・Git記録する。実API/本人認証/重要Audit/Memory等の残件と実業務納品を別途維持する。

# 共通Taskのcomment/artifact実consumer

[共通write計画](2026-10-07-core-provider-writes.md)の残二操作。更新単位の最終検証・公開後に着手する。既存Local保存とLinear human Approval/claim/receipt/観測を再利用し、新mutation engineや背景同期を作らない。

1. addCommentをAsyncTaskProviderとawait consumerへ実接続する。actor/version/Approvalを明示contextとし、CoreはTaskCommentを扱う。Localは原本保存、Linearは既存外部comment承認対象とCore入力の対応を明示する。コメントID/body/actorの一致をcredential前に検査し、返却形は原本とreceipt参照を区別する。不要な外部送信とLocalの隠れたstageを行わない。
2. linkArtifactはLocal input/output stageと、確定済みoutput原本の外部リンクを可視操作として分ける。外部承認があるときは既存artifact ID/URI/version/titleを照合し、methodがwrite後にLocal stage失敗を隠さない。LocalとLinearの共通入力・結果の意味を先に設計する。
3. 実CLI/native daemonのREDから小さく進める。未承認/原本変更/actor不一致/unsupported inputは送信ゼロ、承認後一回、保存障害・応答不明・再送禁止・observe/reopenを検証する。Core→両Adapterの実await consumerを確認し、個別legacy commandだけで六操作完成としない。
4. 指針/リファレンス/Ponytail-review、全local gate・実Jev・一回fresh final reviewを適用し、結果をwork-log/verificationに保存・Git記録する。実API/本人認証/重要Audit/Memory等の残件と実業務納品を別途維持する。

## 最小契約

- `addComment(id, TaskComment, TaskWriteContext)`は`{id, reference}`を返す。referenceはLocalでnull、Linearでconfirmed receipt ID。LinearではCore comment IDが承認operationの既存UUIDと一致し、actorもcontext一致することを送信前に検査する。createdAtはCore入力metadataで、外部の作成時刻と装わない。Localは現在versionを同transaction内で照合して原本insert。外部commentをLocal comment原本へ暗黙二重保存しない。
- `linkArtifact(id, TaskArtifact, direction, context & {title?})`は`{task, reference}`を返す。LocalはartifactをCAS付きでstageしreference null。Linearはoutputだけ、title必須、同Taskに明示stage済みのartifact ID/URI/createdAt一致を検査し、既存Approvalで外部リンクを送る。Task/versionを変更せずconfirmed receipt IDを返す。input送信/未stage/原本不一致をcredential前に拒否する。
- CLIは既存`task comment/artifact`へprovider付きの明示actor/version/ID/metadataを追加する。旧provider無し操作は維持。request-linear-commentのrequest IDをCore comment IDとして使う。外部artifactは既存stage→request-linear-artifact→approve→provider linkの明示手順。CoreへLinear SDK/UUID fields/GraphQL応答を公開しない。
- SQLiteの既存addComment/linkArtifactへoptional expectedVersionを追加し、既存callersは維持。共通consumerでは必須context versionを渡し、preflightのみのcheck-then-writeをCASと呼ばない。追加DDL/背景syncなし。

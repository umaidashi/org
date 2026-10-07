# 承認済みRuntime Linear Taskの再開・観測

Spec: [要件](../../requirements.md)、Notion 04/06/08。Runtimeが保存したrunning原本と操作承認から継続し、Agentを再呼出しせず一回送信する。

## Task 1: Task-bound再開と不明結果の回収

1. 実daemonのRuntime提案→操作待機→human approve→明示resume→検証済みreceipt Artifact→結果reviewを、content/fieldsでREDから確認。pending/reject/no effect、WorkItem進行、HTTP応答不明、claim/receipt/Artifact/Task保存障害、再起動/並行操作/no replayを追加。
   Expected: 未対応commandでRED。結果不明の再開でmutationを再送しない。
2. 既存Linear update engine/Task-bound source resolverとWorkflowの原本snapshot履歴照合を再利用する。承認bindingのrunning Task snapshotから現在のwaiting/running/blockedまで、状態以外の変更がないこと・owner/Room Message/parent WorkItem/入力/四capability/write scope/dependencies/CASを確認。trusted source viewを使う場合も毎回最新Taskを照合し、CLI/RPCからcallbackやphase overrideを受けない。
   Expected: authority不一致は秘密/HTTPゼロ。元binding/Approval/claim/receiptを変更しない。
3. 更新成功は既存Task Artifact保存/関連付けと人間結果reviewへつなぐ。送信前の失敗と一致する先行claim後の不確定を分け、後者はblockedからstatus-only観測する。known updated/observed receipt再利用、外部現在値のobservedは送信成功と区別する。Artifact/stage障害は既存pending errorを再利用し、元receiptから再関連付けする。
   Expected: Task進行・再起動・並行勝者で一回送信/原本唯一。偽造claim/receiptや保存失敗を成功扱いしない。
4. DI高速UT、全check、送信前非空dry-run、実Jev、Ponytailと独立正しさreview、ログ/Git/main通常公開。
   Expected: 全gate終了0、skip/実API未確認を明示。

Core TaskはLinear固有状態を持たず、外部操作は非同期compositionに置く。新DDL/依存/汎用retry/frameworkを追加しない。原本source照合→claim/外部writeの跨process原子性・外部CAS・送信後即時撤回は保証しない。実API/本人認証/実業務Draft PRは全体残件。

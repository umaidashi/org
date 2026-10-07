# Core patchと共通updateの承認付き実consumer

[共通write計画](2026-10-07-core-provider-writes.md)に従い、複合writeの次はCoreのtitle/objective/status/owner/priority/labelsを実際の承認consumerへ接続する。

1. 既存request/apply-linear-update CLIへCore patch入力を追加するnative REDから始める。Core入力と既存UUID fields/top-level content入力は相互排他にする。Coreへ外部UUID field名を要求せず、host mappingだけをcompositionで解決する。
2. state/ownerの逆mappingは該当値が一つだけの時に許し、欠落/曖昧な対応をcredential前に拒否する。owner nullは無担当解除。labels名→UUIDはhost設定の明示対応を追加し、名前検索/推測や不完全labels pageからの自動生成はしない。既存states/ownersだけの設定を読取で維持する。
3. objective→description、title/priorityは共有field parserへ接続する。閉じたpatchで型/空/範囲/NUL/重複labelsを拒否する。parent/dependencies/成果物等はLocal所有であり外部入力へ送らない。Local関係の共通update契約は次の実consumer接続時に明示し、未対応を成功扱いにしない。
4. Agent登録の取得前後確認、Team/Issue scope、Task version、human Approval/digest/claim/receipt/未知結果観測を維持する。mappingが承認後に変更された場合も異なる入力は送信しない。nativeでrequest/approve/apply/observe/reopen、曖昧mapping/未知label/競合時の保存・送信ゼロを検証する。
5. 同じ検証単位でAsyncTaskProvider.updateをLocal/Linear両実装と実際にawaitするCore consumerへ接続する。actor/expectedVersion/承認IDを操作contextとして明示する。Localは既存状態機械/CASを使い、Linearは外部write receiptを先に確定してから既存ミラーをCAS同期する。外部成功後の同期障害を隠さず、receipt/observe/getから回復させてmutationを再送しない。Local所有の関係/成果物を消さず、未対応patchを成功にしない。
6. DI/native/全gate/実Jev/Ponytail/独立reviewを記録する。準備commandやpure mappingだけで共通update・六操作完成にしない。残comment/artifact、実API/本人認証/実業務納品と他の全体残件を維持する。

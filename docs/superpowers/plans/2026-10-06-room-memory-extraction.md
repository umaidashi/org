# Room原本からの保守的Memory候補抽出

Notion Memory仕様を再取得（2026-10-06）。immutable history→candidate extraction→dedup/conflict→typed projectionを進める。ユーザーの「迷わなければ確認不要・Nextがある限り継続」を優先して、設計/計画を保存して自分で実装する。

## 設計

`memory extract --room ID --message ID`はactive Room参加Agentの原本Messageに保存された`{"version":1,"tool":"memory","candidates":[...]}`を受け取る。Runtimeは既存Session/Room返信経路で候補を生成する。native extractor PortはJSONをunknownとして厳密に解析し、最大10候補/本文16KiB/原本Message64KiB。typeは既存4種、confidenceは0..1、sourceMessageIdsは同じRoomで提案より前の原本1..20件。scopeはhostがroom:IDへ固定し、proposal原本もsourceRefsへ追加する。任意scope・未来/外部Room参照を拒否。Agentのcan_read/can_writeを必要とする。CLIはlocal adminによる明示採用で、Agent本人認証ではない。

候補全体を検証してから保存。候補ごとの安定IDはRoom/proposal/indexのhash、createdAtはproposal.createdAtで固定しcreateOnceを使う。途中保存失敗後は同proposalを明示再実行できる。完全一致type/contentで既存Memory（non-activeも含む）を保守的に再利用し原本sourceは変えない（意味dedupやsourceマージではない）。無効化済みの同proposalはcreateOnceの投影結果を返し復活させない。supersedesは同Room/typeの既存activeに限定し、異なる候補から同じ旧Memoryを重複置換しない。意味競合は自動判断しない。

## 実装計画

1. DBなしUT RED: extractor moduleなし。厳密shape/サイズ/4type/refs/scope/caps/全候補先行検証/安定再実行/完全一致dedup/明示supersedesを検証。
2. MemoryExtractor Port+JSON Adapter+projection serviceを実装。時間/ID/Provider/Room/AgentをDI、直接infra依存なし。
3. 実CLI RED: extract未対応。directおよびdaemon経由で原本保存→抽出→重複/no revival→再open、元Message保持をGREEN。
4. 既存Runtime fixtureと可能なら実Claude Maxで厳密候補Message→extract→scoped Contextを小e2e。全check/実jev/独立最終review1回（Importantは1fixpass）、文書/証拠/Git/main通常push。

夜間consolidation、semantic dedup/競合推定、他scope・他history source、採用認証は別要件。


Ruling（独立review後）: dedup先がinvalidated/supersededになった場合も完全一致Memoryを再利用し、抽出から新activeを生成しない。新しい根拠の同じ内容も自動再有効化しないため、再採用したい場合はlocal adminの明示captureで判断する。この保守性はconservative policyに合わせる。stable候補IDと異なる既存dedup先に別採用receiptを追加する方式は、この段階では導入しない。

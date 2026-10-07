# Room候補へ既存の外部原本根拠を接続

Notion03のEvents/Artifacts/Workflow executions/Decisionsは不変原本。既存Room typed候補抽出とcaptureのReaderを再利用し、新抽出engineやWorkflow storeを作らない。

1. strict Room candidateにoptional `sourceUris`を追加（既存必須sourceMessageIdsを維持）。Event、hash Artifact、TaskReview、確定Approval Decisionのcanonical URIだけを受理する。unknown URI/duplicate/NUL/過大/未確定/欠落/壊れたblobを採用前に拒否する。scopeは既存同Roomのまま、勝手なglobal/他Room昇格なし。
2. 実CLIのAgent原本候補からEvent/Workflow receipt/Artifact/Decision根拠付きMemoryを抽出し、再openと再採用no replay/失効後no revival/全原本不変を確認するRED。複数候補の後方Reader失敗でも保存ゼロをDIと実DBで確認する。
3. captureMemoryの既存根拠検証を共有helperへ切り出し、抽出候補の全根拠を先行awaitしてから既存dedup/createOnceへ進む。Artifact読取のため既存extract関数/実callerをasyncへ変え、CLIとdaemonの明示/自動経路を必ずawaitする。検証結果を捏造するstubや別ストレージを作らない。
4. CLI compositionは必要な公開Readerだけを閉じる。daemonは既存Task/Event/Approval/Artifact readerをDIする。Memory抽出のhost opt-in/Agent can_read+can_write/過去同RoomMessage/immutable proposal IDを維持。URIの存在照合とMemory本文の真偽・人物認証は区別する。
5. scoped metadata conflict/明示supersedes/全候補先行検証/再起動互換を維持。Runtime strict JSON promptへ追加URI方式を説明し、許可されていないsource/credentialsをモデルへ自動送信しない。原文/機密をJevへ送らない。
6. RED/GREEN、型/全gate/実Jev、一回fresh全単位review/Ponytail、証拠・ログ・Git。候補はRoom原本に固定し、全scope自動抽出/夜間policy/本人認証/実業務納品は別残件。原本抽出を推測型semantic engineへ広げない。

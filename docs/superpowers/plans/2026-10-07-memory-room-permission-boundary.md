# Room permissionをMemory抽出へ接続

Room Context送信の明示policyを実装後、同じRoom原本を読むAgent操作を棚卸し。extractRoomMemoriesは参加者/can_read/can_writeを前後検査するが新しいrooms policyを未照合。過去のproposalを権限失効後に採用できる具体的な兄弟callerとして扱う。

1. 小さなDI RED: participantかつcan_read/can_writeでもRoom許可なしではextractor/Memory保存を呼ばない。evidence await中のrooms grant失効後も保存ゼロ。許可/legacy対照。
2. 既存2行のRoom policy判断をagents/domainの純粋guardへ移し、sessionAgentとextractRoomMemoriesの開始/保存前で再利用。新policy engine/provider/設定なし。
3. 実CLIでAgent Room proposalとhuman Approval policy失効→memory extract拒否/Memoryゼロ、許可対照、reopenを検証。fullcheck/実Jev/fresh一review/Ponytail/記録/main通常push。

既に読んだ情報の回収・Memory extractionと他writerの完全原子性を保証しない。重要操作Audit/実業務APIは別残件。

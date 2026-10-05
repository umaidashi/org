# 実Claude委譲→コード生成→実Dockerテスト→人間review→Memory

外部業務Issue/repoが未指定の間、専用fixtureの内部Taskで実コード経路を実証する。既存実Claude二Agent proofを再利用し、opt-in `ORG_CLAUDE_CODE_TEST=1` の第二経路を追加する。通常suiteはskip。

Coordinatorは専門Agentへsafe integer加算関数とBun testファイルの実装を委譲。host Sandbox policyはwritable/no network/固定2artifact path/30秒。専門Agentは既存strict Sandbox JSONを返し、KernelがDockerで実行・テスト・file Artifactを保存する。原本proposal参照を照合し、hostが取得したimplementationを別の実Dockerで固定の独立assert群（正負/0/非整数/overflow）へかける。Agent自身のstdoutだけでテスト成功/approveを判断しない。

成功後は既存human review→episodic Memory→same Coordinator Session→restart no duplicateを確認。業務Issue/Draft PR、実Linear API、一般tool loopはこのproofでは完成扱いしない。新Issueや外部書込みなし。自作daemon/temp DB/containerだけをcleanup。

製品変更は不要。実物経路を追加検証するため製品未実装REDは不要。独立verification guardの不正入力はUTで確認する。全check/実jev/独立最終review/Git/main pushへ進む。

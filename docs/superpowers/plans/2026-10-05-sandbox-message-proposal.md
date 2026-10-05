# Agentの構造化MessageからSandboxを実行する

- Task Roomで既存のroom activateを使い、tools無効のRuntimeに厳密JSON `{version:1,tool:"sandbox",code:"TypeScript"}` を生成させる。
- `sandbox run TASK --proposal MESSAGE` は同Taskのactive Roomとowner Agent発言を検証し、JSONの未知fieldを拒否。repo/writable/files/resource limitsは呼出側の既存CLIだけが指定する。Agent出力からhost pathや権限を設定しない。
- 既存Sandbox serviceで最新owner/capabilities/stateを実行直前に検証し、既存running CAS/Artifact stage/cancel/drainをそのまま利用する。成果物には原本Messageのorg URIを含める。
- 最初は明示CLIでproposalを選ぶ一周。自動tool loop/複数tool/MCP/資格情報注入は実callerが必要になった後に追加する。
- pure proposal境界UT RED→GREEN、実CLIの未知flag RED→GREEN、実Dockerで生成Message→権限拒否/実行→Artifact/人間reviewを確認。実Claude Maxも同じ経路で検証する。

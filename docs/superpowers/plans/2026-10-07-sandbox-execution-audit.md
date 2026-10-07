# Sandbox実行の原本Audit

Notion08の重要操作Auditを、既存Sandbox実行の全実callerへ接続する。Task状態履歴のgeneric execution Auditはそのまま残し、code/stdout/stderr/credentialを新Auditへコピーしない。既存immutable EventBusとcollectAuditを使い、新DB/store/汎用event frameworkを作らない。

1. 本物のSQLiteを使うSandbox service testで、成功・非zero・timeout・cancel・run/save/storage障害について、Task実行versionとactorに結び付く開始/結果receiptが取得できないREDを確認。Audit storageが開始前に失敗したらrunner/saveを呼ばない。
2. `produceSandboxArtifact`の共有経路で既存Event publishをDIし、snapshot task owner/ID/実行version・入力digest・proposal原本ref・元Event ref・approval null・時刻・結果とArtifact refを記録。入力本文、stdout/stderr、host repo path、秘密値はpayloadへ保存しない。開始receiptを先行保存し、そのTask実行versionで重複実行させない。結果保存失敗時は開始だけが残り、不明状態を成功に言い換えない。
3. direct/daemon明示runとRuntime Task proposalの両callerへ同じEventPortを配線する。CAP/Task/Room照合後だけ実行をclaimする。全resource cleanupと旧Artifact内容/CAS/Task失敗挙動を維持する。run/save/receiptとTask保存は異なるtransactionで、跨操作の全原子性を主張しない。
4. collectAuditにSandbox専用pure decoderを接続し、receiptと原claimの因果照合、 actor/task/event/tool/input/output/time/result/approvalを投影。元receipt不正なら失敗を伝播し、現在ownerから過去executorを推定しない。claim-onlyはstarted/unconfirmedとして扱い、successは成果物保存まで確認した場合だけ。
5. 実Dockerのdirect/daemon CLIとRuntime proposal fixtureでlogs一覧/agent tail/再openに同一原本を確認、失敗・cancel・未実行の除外とsecret sentinel非保存を検証。データはsynthetic、network noneを維持する。
6. 最終全gate、実Jev、fresh whole-unit reviewer一回とPonytail、証拠・Rulings・ログ・Git・main通常push。Sandbox network/限定credential、RPC本人認証/全resource permission、一般Task retry、実業務納品は別残件として維持する。

# 明示Agent Room Context permission

01のpermissions fieldを、閉じた有限rooms allowlistとして実装。capability/membership/host service grantを追加制限する。旧Agentの未設定は既存制約、明示空配列は全Room Context拒否。wildcard/Role継承/別policy engineなし。初期trusted host登録後の変更は既存human Approval/CAS/不変permission履歴で行う。policy省略は現状維持。

- domain/Session guard RED→focused8成功94ms。開始/再開/rebuild/late completionと旧provider保持を検証。
- SQLite Approval readbackが新fieldを落とすRED→既存parser修正、14成功61ms。未承認拒否/DB reopen/省略保持/古いreceipt再実行でrevision不増を確認。
- nativeCLI fixtureは初回Room type/Session --agent誤指定を修正。初回setupが残したowned一時DBのみ削除、setup全体をfinallyへ置いた。固定sleepをhuman承認後release markerにし、beforeRuntime拒否/deny・restore・active turn後deny/原因stderr/履歴Audit/direct reopenを確認。最終focused4成功2.21秒、fixture providerなので実API認証ではない。
- fresh reviewer C0/I0/M0/Ponytail Lean net0。親のJev候補確認で疎配列がdomain検査を通る欠陥を別途RED→Array.fromの1行修正。1fixpass/再レビューなし。有限最大値拒否もチェック。
- final全check519成功21skip0失敗540tests212files184.25秒、type/Oxlint/Oxfmt369files/非空AST/dry-run成功。実Jev2402subjects146warnings/missing・unsure・review・errors・degraded0。
- Notion root/01/03/08をconnectorで再取得、前回fetchとのcontent body一致を確認。raw本文は新規保存/外部意味レビュー送信していない。

Room Context送信を検証したもので、他resourceの一元永続化や本人認証の証明ではない。次の既存Memory抽出callerは明示rooms=[]でもDI保存1件を呼ぶ反例があり、[次計画](../../superpowers/plans/2026-10-07-memory-room-permission-boundary.md)へ継続。全体未達。

# Agentの外部Linear読取Audit

重要操作inventoryの具体的な欠落: src/linear/agent-read.tsの外部Issue読取はAgent scope/credential/capabilityを照合するが、外部読取開始・成功・失敗のactor/resource記録を残さない。唯一のproduction callerはtasks CLI（daemon RPCも同じcaller）で、既存EventBusとAuditEntryを再利用する。

1. shared readAgentLinearIssueへEventBus/clock/IDをDIし、scope拒否はHTTP/secret/開始Auditゼロ。開始保存障害もHTTPゼロ。成功/外部失敗/late scope変更は原本startedから終端Auditを保存することをRED。
2. 値/body/tokenをAuditへ入れず、actor Agent・Issue UUID・source/tool・input/output reference・time・result・null Task/Event/Approvalの明示文脈を保存。原本不一致/偽造terminalをAudit projectionで拒否し、保存失敗を成功としない。
3. CLIの既存EventBus配線へ接続しdirect/daemon/reopen実HTTP fixtureで結果と8fieldを確認。全localgate/実Jev/一回fresh review/証拠・worklog・requirements・Git/main通常push。

本人認証、全読取の大量trace、private本文コピー、汎用logger/別DBは追加しない。Linear Agent read以外のinventoryとresource permissionsは未達として続ける。

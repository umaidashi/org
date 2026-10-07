# MemoryのEvent原本参照

Spec: [全体監査](../../completion-audit.md)のNotion03 source evidence、[全体要件](../../requirements.md)。既存captureMemory/SourceRef/EventBusのget/SQLite不変Eventを使う。新SourceReader interfaceや抽出engineは作らない。

## Task 1: Eventから手動Memory captureまでの小さなe2e

1. 既存Memory CLI e2eにEvent publish→`memory capture --source-event EVENT_ID`→再読取りを追加し、未対応optionのREDを確認する。
2. canonical `org://events/<encodeURIComponent(id)>`を既存URI型で表現する。未知URI、非canonical encoding、空IDは保存前に拒否する。TaskReview/Messageの既存sourceは維持する。
3. captureMemoryに既存EventBusのgetだけをDIし、ID一致と原本存在を保存前に確認する。CLIは必要なreaderだけを開き、finallyで閉じる。source-event/source-review/room-messageの曖昧な組合せは拒否する。
4. DIでreader不在・不一致・取得障害・保存障害、native CLIで未存在Event・再読取り・Event原本不変と旧sourceのデグレを確認する。全check/非空dry-run/実Jev/Ponytail/独立正しさreview→ログ/Git/main通常公開。

Event参照は原本の存在を証明し、内容の真実性やMemory抽出の自動化を証明しない。Workflow/Artifact/一般Decisionのprovenance、全関係scope、共通Linear TaskProvider、resource permission、実API/本人認証/業務納品は残す。

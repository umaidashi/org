# TUIのRoom名とSession監視

根拠: Notion Daemon/TUI仕様とdocs/requirements.md。TUIはdaemonの公開read clientに限定する。

## 設計

Roomのsummaryはnameでなくtitleを使う。表示に必要なid/name/title/role/type/statusはnonblank stringとして全recordを検証し、不正な結果を空行へ変換しない。Eventはid/typeだけを表示する。制御文字除去と既存の行数・端末幅制限を維持する。

session list --jsonを他の一覧と並行取得し、Agentごとにrunning/idle/failed/stoppedの件数を全Sessionから集計する。複数Roomで同時にrunningとfailedが存在し得るため、一つの推測状態へ潰さない。SessionがないAgentはsessions=0。providerSessionId/error/本文を表示しない。必要なSession id/agentId/statusのみ境界で検証する。別AgentのSessionを混ぜない。状態件数を行先頭に置き、80列でも長い名前に押し出されないようにする。各一覧取得は独立した読取であり、原子的snapshotではない。

## 実装計画

1. DBなしUTでRoom title、必須field（11件目も）、複数Room状態件数、未使用Agent、未知status、Session通信失敗をRED確認。
2. 公開command DI内で境界validation/summaryを実装しGREEN。
3. 実daemon/実PTYで日本語Room titleとSession状態、refresh/quit端末復元を確認。
4. 全check/実jev/独立最終review一回、Importantのみ一修正pass、証拠・ログ・README・要件更新、Git/main通常push。

## Review Focus

表示対象外recordのvalidation、同じAgentに複数Session、制御文字、read失敗伝播、秘密field非表示。Sessionのactivityはread時点の状態でありAgent本人認証やRuntime隔離の完成を主張しない。

# 最近追加したDB不要UTを高速コマンドへ追加

目的: ユーザー指定の高速な最小UTを、最近実装した外部readと明示projectionでも日常実行できるようにする。
既存test:unitの明示ファイル列挙を再利用する。新runner/依存/自動分類なし。
追加対象8ファイルは注入したPort/HTTP値だけで検証し、実DB・実ネットワーク・CLI process・実Runtimeを使用しない。

1. 既存test:unitで新Linear list test名を指定し、0件/exit1のREDを確認。
2. Linear read/list/import/refresh、Notion read/Room snapshot、Room自動Memory、Workflow status pollを既存コマンドへ追加。
3. 同pattern GREENと全高速UT、全check/実jev/独立最終review一回、Git/main push。

Ruling: 全UT自動発見は追加しない。明示リストの手動更新が必要で、追加漏れは全checkでは失敗しない。全checkとpre-pushの全テストは維持する。

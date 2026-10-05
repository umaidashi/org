# 公開GitHub Eventの明示取込

- 要件のGitHub Event Adapterを、既存EventBus/Subscription/daemonへ接続する。native fetchと公開REST GETのみ、資格情報/外部書込/新serverなし。
- `event import-github OWNER/REPO`。入力検証をDB作成前に行い、固定api.github.com・redirect拒否・10秒/response 4MiB・最大3ページ100件。全response検証後に古い順で既存publishOnceを使う。
- GitHub repo ID/event IDをEventの決定的IDへ変換。public/一致repo/UTC時刻/JSONを検証。繰返し取込は保存済み原本を保持し、可変actor metadataで原本を書換えない。安定type/source/timeが違えばconflict。
- native fetchを引数DIし最小UT RED→GREEN。実CLIはfixture preloadでnative fetch境界だけ差し替え、実SQLite再open/Subscription/daemon Task一周とduplicateなしを確認。実公開GitHub GETもprivate tmpで確認する。
- GitHub Events APIは最新300件/30日、30秒〜6時間遅延のある明示取込でありwebhook/realtime/全履歴ではない（公式 https://docs.github.com/en/rest/activity/events）。自動poll/ETag cursor/認証private Eventは後続。
- 全check/実Jev/独立final review、ログ/通常main push。

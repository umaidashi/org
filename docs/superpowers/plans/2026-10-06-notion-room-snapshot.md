# Notion文書のRoom原本取込

Phase6 knowledge/docsを既存のRoom原本とContextへ接続する。新テーブル・queue・自動起動は追加しない。

`knowledge notion PAGE_ID --room ROOM --human HUMAN` は明示local admin操作。両flag必須、active Roomの参加humanを読取前に確認する。DIのget/appendとread関数を使い、既存Room appendで保存時にも参加者/archiveを検査する。取得文書のURL/hashを本文先頭とmetadataに記録し、既存Contextが出典を保持できるようにする。各明示取込は新しい不変Message、再読取の同一hashも新Messageであり自動dedup/retryは保証しない。Notion側書込、Runtimeへのkey注入、自動activationなし。

1. DBなしUTで非参加者/archiveがread前拒否、取得失敗時appendなし、正常原本/出典保持のRED。
2. 既存CLIにpaired flagsとdb配線、native Room保存へGREEN。
3. 既存HTTP fixture CLIを拡張してread→Room原本→再open→Context出典を確認。実Notionはkey設定後のみ。
4. 全check/実jev、独立最終review一回、必要Important一fixpass、Git/main push。

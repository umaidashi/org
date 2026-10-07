# 所有daemonのstale socket回復

1. 既存Workflow native e2eでSIGKILL後も同じsocketを使い、現行EEXISTのREDを確認する。
2. ready前にprivate lock内へPID・lock/socket inodeの所有記録を保存する。終了判定は既存Database leaseのprocessAliveを再利用する。
3. 起動時は排他的な復旧guardを取り、記録の型・所有UID/permission・通常ファイル・inode・PID終了を確認してから既知socket/所有記録/空lockだけを回復する。未知記録・symlink・置換・live ownerは拒否する。一般の再帰削除はしない。
4. 所有記録も終了時inode一致のみ削除する。SIGKILL→同socket再開・同時起動・live/置換保護をnative CLIで確認する。
5. 型・全テスト・lint/AST・実jev・独立/Ponytail reviewを行い、結果と未検証窓を保存する。

新しいlock framework/dependency/daemon commandを増やさず既存server lifecycleとPOSIX PID確認を使う。記録保存前のcrashや旧形式のlockは、所有者を証明できないため無条件削除しない。

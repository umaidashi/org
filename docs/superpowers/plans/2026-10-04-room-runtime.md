# Roomの会話からRuntime応答を残す

既存Room Messageを入力に、同じRoomのSessionへ送信してAgent replyを不変Messageとして保存する。新しい `session reply ID --room-message MESSAGE_ID` はdaemon専用。送信者を推測して新しいhuman messageを作らない。

DIしたRoom/Session公開Port、runtime send、clock/IDを利用する。入力Messageまでの履歴だけを、最大30件/64KiBの明示的に省略数を含むJSON Contextへ構成する。後から届いたMessageを当該応答のContextへ混ぜない。違うRoom、archive、入力なし、Session参照違いは実行前に拒否する。provider失敗やstopではAgent replyを書かない。

既存の同じSession/Messageへのreplyは返して再実行を避ける。ただしprovider呼出しとDB appendは同一トランザクションではなく、途中でprocessが落ちた際の厳密なexactly-onceは保証しない。Room summary/Memoryからの新provider Session再構築、Task統合、activationは後続。

DB-free UTのRED→GREEN、実CLI/daemon/SQLite/fixture応答保存e2e、全suite/実jevと独立レビュー、要件とログを残す。

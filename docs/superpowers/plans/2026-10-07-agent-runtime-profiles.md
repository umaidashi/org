# Agent別Runtime host profile

Notion Securityのworking directory/credential/tool分離可能性を、既存RuntimeTurnInput.agent.idとDriverConfigで接続する。

## 契約
- host runtime JSONのoptional agentsはAgent ID→既存codex/claude config。共通provider設定は旧形式の既定値として維持する。
- 明示Agent profileが存在する場合、その中に対象runtimeがなければ起動を拒否し、共通credentialへfallbackしない。
- envは旧string配列に加え、child変数名→host変数名の明示mapを受け付ける。literal秘密をconfigへ置かず、各ActorのHOME/credentialを同じchild変数名へ別々に注入できる。
- 既存path/limits/変数名検証を再利用。nested profile/空profile/不正Actor ID/未知fieldを拒否。host environmentのown string値だけを解決し、継承値や未選択envを注入しない。
- 一つのdaemonで2Agentの異なるcwd/HOME/credentialとresume、旧provider default、明示profileのruntime不一致→process未起動を実CLIで検証する。
- cwd/env選択は物理filesystem/Keychain/IPC隔離ではない。Sandboxは既存Docker境界を維持する。

## 手順
1. DB不要parse UTとnative CLIを先に追加しRED。
2. 既存parseRuntimeConfigとconfiguredDriversだけに接続。新Port/DI container/依存なし。
3. targeted/native→型/full check→実jev、共有Runtime配線変更の実Claude Memory proofを確認。
4. 一回の独立正しさ/安全性/Ponytail review、Important一fixpass・再reviewなし、証拠とmain通常push。

Ruling: profileはfull DriverConfigで、共通env/cwdとmergeしない。誤った場合、mapped Agentのexecutable/env等も明示する手間が必要だが、別Actorのcredentialの暗黙継承を避ける。

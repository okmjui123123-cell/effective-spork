# LINE AI 助手

把你的 LINE 官方帳號變成 AI 助手：傳訊息給它，它用 Claude 回答你。

跑在 Cloudflare Workers 上（免費方案每天 10 萬次請求，個人使用綽綽有餘）。

## 為什麼用「回覆訊息」而不是「推播」

LINE 免費方案每月的訊息額度只算**主動推播（push）**，你先傳訊息、它回你的**回覆（reply）不計入額度**。所以這個助手不會像新聞推播那樣撞到每月上限。

## 部署步驟（用 Cloudflare 後台，不需要裝任何工具）

### 1. 取得 Claude API Key

1. 到 https://console.anthropic.com/ 註冊/登入
2. 左側 **API Keys** → **Create Key**，複製產生的 key（`sk-ant-...` 開頭）
3. 到 **Billing** 儲值一點額度（個人聊天用量通常一個月幾十塊台幣）

### 2. 建立 Cloudflare Worker

1. 到 https://dash.cloudflare.com/ 註冊/登入
2. 左側 **Compute (Workers)** → **Create** → **Start with Hello World!** → **Deploy**
3. 部署完成後點 **Edit code**，把 `worker.js` 的內容**整個複製貼上**取代原本的程式碼，按 **Deploy**
4. 記下這個 Worker 的網址，長得像 `https://line-ai-assistant.你的帳號.workers.dev`

### 3. 設定三組 Secret

在 Worker 頁面 → **Settings** → **Variables and Secrets** → **Add**，型別選 **Secret**，加這三組：

| 名稱 | 值 |
| --- | --- |
| `LINE_CHANNEL_SECRET` | LINE OA Manager → 設定 → Messaging API 裡的 Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers Console → Messaging API 分頁的 Channel access token (long-lived) |
| `ANTHROPIC_API_KEY` | 第 1 步取得的 Claude API key |

加完後按 **Deploy** 讓設定生效。

### 4. 把 LINE 的 Webhook 指到 Worker

1. 到 LINE Official Account Manager → **設定** → **Messaging API**
2. 「Webhook網址」填入你的 Worker 網址（第 2 步記下的那個），按 **儲存**
3. 到 LINE Developers Console 的 Messaging API 分頁，確認 **Use webhook** 是開啟的
4. 同一頁把「自動回應訊息」關掉（不然 LINE 的罐頭回覆會跟 AI 回覆打架）

### 5. 測試

用手機 LINE 傳一句話給你的官方帳號，幾秒內應該會收到 AI 回覆。

沒反應的話，到 Cloudflare Worker 頁面的 **Logs** → **Begin log stream**，再傳一次訊息看錯誤訊息。

## 選用：讓它記得前文

預設每則訊息都是獨立的，它不會記得你上一句說什麼。要加上記憶：

1. Cloudflare 後台左側 **Storage & Databases** → **KV** → **Create Instance**，名稱填 `chat-history`
2. 回到 Worker → **Settings** → **Bindings** → **Add** → **KV namespace**
   - Variable name 填 `CHAT_HISTORY`
   - KV namespace 選剛剛建立的 `chat-history`
3. **Deploy**

之後它會記得每個使用者最近 20 則訊息，保留 24 小時。

## 用指令列部署（進階）

如果你習慣用 CLI：

```bash
cd line-ai-assistant
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

要啟用對話記憶的話，先跑 `npx wrangler kv namespace create CHAT_HISTORY`，再把回傳的 id 填進 `wrangler.toml`。

## 調整行為

都在 `worker.js` 最上面：

| 常數 | 說明 |
| --- | --- |
| `SYSTEM_PROMPT` | 助手的個性與回答規則，想改語氣或專長就改這裡 |
| `MODEL` | 預設 `claude-opus-5`。想省錢可改成 `claude-sonnet-5` 或 `claude-haiku-4-5` |
| `MAX_TOKENS` | 單則回覆的長度上限 |
| `MAX_HISTORY_MESSAGES` | 記住幾則訊息（需要 KV binding） |

改完記得重新 Deploy。

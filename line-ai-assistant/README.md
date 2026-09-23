# LINE AI 助手

把你的 LINE 官方帳號變成 AI 助手：傳訊息給它，它用 AI 回答你。

**完全免費**，跑在 Cloudflare Workers + Workers AI 上，不需要信用卡。

## 為什麼不用花錢

兩個環節都在免費額度內：

| 環節 | 免費額度 | 超過會怎樣 |
| --- | --- | --- |
| LINE 回覆訊息 | 不計入每月推播額度（只有主動推播才算） | — |
| Cloudflare Workers | 每天 10 萬次請求 | 超過才需付費，個人用量碰不到 |
| Cloudflare Workers AI | 每天 10,000 neurons | **回錯誤，不會扣錢**（要超額必須自己主動升級付費方案） |

實際上大約是**每天幾十則訊息**。額度每天台灣時間早上 8 點（UTC 00:00）重置。

代價是模型用的是 Llama 3.2 3B 這類小模型，理解力和文筆比不上 Claude 或 ChatGPT，回答簡單問題沒問題，複雜推理會露餡。

## 部署步驟（全部在 Cloudflare 後台點，不需要裝任何工具）

### 1. 建立 Cloudflare Worker

1. 到 https://dash.cloudflare.com/ 註冊/登入（免費方案即可，不用填信用卡）
2. 左側 **Compute (Workers)** → **Create** → **Start with Hello World!** → **Deploy**
3. 部署完成後點 **Edit code**，把 `worker.js` 的內容**整個複製貼上**取代原本的程式碼，按 **Deploy**
4. 記下這個 Worker 的網址，長得像 `https://line-ai-assistant.你的帳號.workers.dev`

### 2. 綁定 Workers AI

1. Worker 頁面 → **Settings** → **Bindings** → **Add**
2. 選 **Workers AI**
3. Variable name 填 `AI`
4. 按 **Deploy**

### 3. 設定兩組 Secret

在 Worker 頁面 → **Settings** → **Variables and Secrets** → **Add**，型別選 **Secret**：

| 名稱 | 值 |
| --- | --- |
| `LINE_CHANNEL_SECRET` | LINE OA Manager → 設定 → Messaging API 裡的 Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers Console → Messaging API 分頁的 Channel access token (long-lived) |

加完後按 **Deploy** 讓設定生效。

### 4. 把 LINE 的 Webhook 指到 Worker

1. 到 LINE Official Account Manager → **設定** → **Messaging API**
2. 「Webhook網址」填入你的 Worker 網址（第 1 步記下的那個），按 **儲存**
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

注意：帶入前文會讓每次請求變長，消耗的 neurons 也會變多，每天能聊的則數會變少。

## 用指令列部署（進階）

如果你習慣用 CLI：

```bash
cd line-ai-assistant
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler deploy
```

要啟用對話記憶的話，先跑 `npx wrangler kv namespace create CHAT_HISTORY`，再把回傳的 id 填進 `wrangler.toml`。

## 調整行為

都在 `worker.js` 最上面：

| 常數 | 說明 |
| --- | --- |
| `SYSTEM_PROMPT` | 助手的個性與回答規則，想改語氣或專長就改這裡 |
| `MODEL` | 預設 `@cf/meta/llama-3.2-3b-instruct`。換更大的模型回答更好但更快用完額度，可選清單見 Cloudflare 後台 **AI** → **Models** |
| `MAX_TOKENS` | 單則回覆的長度上限，調小可以省額度 |
| `MAX_HISTORY_MESSAGES` | 記住幾則訊息（需要 KV binding） |

改完記得重新 Deploy。

## 之後想要更好的品質？

把 `askAI()` 換成呼叫付費的 LLM API（例如 Claude 的 `https://api.anthropic.com/v1/messages`），再加一組 API key 的 Secret 就行，其他程式碼都不用動。個人聊天用量一個月大約幾十塊台幣。

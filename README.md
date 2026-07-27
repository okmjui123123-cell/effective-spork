# Telegram 自動新聞推播

每天早上（台灣時間 07:45）自動抓取三類新聞，並透過 Telegram Bot 推播給你：

- 🌏 國際與台灣新聞
- 🤖 AI 相關新聞
- 📍 彰化新聞與活動

## 運作方式

- `scripts/send-news-to-telegram.js` 分別抓取三個 RSS feed，各自篩選出上次執行後的新項目，依分類組成訊息後推送到指定的 Telegram 聊天。
- `.github/workflows/daily-news-to-telegram.yml` 每天用 GitHub Actions 排程執行一次（也可以手動觸發 `workflow_dispatch`）。
- `data/state.json` 分別記錄每個分類最後推播過的新聞時間，避免重複推播。

## 設定步驟

### 1. 建立 Telegram Bot

1. 在 Telegram 搜尋並打開 **@BotFather**，傳送 `/newbot`
2. 依照指示取名字，完成後 BotFather 會回傳一組 **Bot Token**（格式類似 `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`），複製起來
3. 用你自己的 Telegram 帳號傳一句話給剛建立的 bot（先跟它開對話，bot 才能傳訊息給你）
4. 取得你的 **Chat ID**：瀏覽器打開（記得把 `<TOKEN>` 換成你的 Bot Token）：
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
   回傳的 JSON 裡找 `result[0].message.chat.id`，這串數字就是你的 Chat ID

### 2. 設定 GitHub Secrets

到這個 repo 的 **Settings → Secrets and variables → Actions**，新增：

| Secret 名稱 | 說明 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | 上一步取得的 Bot Token |
| `TELEGRAM_CHAT_ID` | 上一步取得的 Chat ID |

### 3.（選用）更換新聞來源

目前預設抓三個 Google 新聞 RSS：

| 分類 | 預設 RSS 網址 | 對應 Actions variable |
| --- | --- | --- |
| 🌏 國際與台灣新聞 | `https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant` | `RSS_URL_GENERAL` |
| 🤖 AI 相關新聞 | `https://news.google.com/rss/search?q=AI&hl=zh-TW&gl=TW&ceid=TW:zh-Hant` | `RSS_URL_AI` |
| 📍 彰化新聞與活動 | `https://news.google.com/rss/search?q=彰化&hl=zh-TW&gl=TW&ceid=TW:zh-Hant` | `RSS_URL_CHANGHUA` |

要更換某個分類的來源，在 repo 設定對應名稱的 Actions variable（Settings → Secrets and variables → Actions → Variables），指向新的 RSS 網址即可，不需要改程式碼。

每個分類每次最多推播 8 則新項目，可用 `MAX_ITEMS_PER_FEED` 這個 Actions variable 調整。

## 本機測試

```bash
npm install
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=xxx npm run send-news
```

## 手動觸發

到 GitHub repo 的 **Actions → Daily news to Telegram → Run workflow** 即可立即執行一次，不需要等到排程時間。

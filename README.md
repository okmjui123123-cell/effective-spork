# Telegram 自動新聞推播

每天早上（台灣時間 08:00）自動從 Google 新聞 RSS 抓取最新新聞，並透過 Telegram Bot 推播給你。

## 運作方式

- `scripts/send-news-to-telegram.js` 抓取 RSS feed，篩選出上次執行後的新項目，推送到指定的 Telegram 聊天。
- `.github/workflows/daily-news-to-telegram.yml` 每天用 GitHub Actions 排程執行一次（也可以手動觸發 `workflow_dispatch`）。
- `data/state.json` 記錄最後推播過的新聞時間，避免重複推播。

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

預設使用 Google 新聞台灣繁中頭條 RSS：

```
https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant
```

若要改成特定關鍵字或分類，可以用 Google 新聞的搜尋 RSS，例如只看「科技」：

```
https://news.google.com/rss/search?q=%E7%A7%91%E6%8A%80&hl=zh-TW&gl=TW&ceid=TW:zh-Hant
```

要更換來源時，在 repo 設定一個名為 `RSS_URL` 的 Actions variable（或直接改 workflow 檔案裡的 `env`），指向新的 RSS 網址即可，不需要改程式碼。

## 本機測試

```bash
npm install
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=xxx npm run send-news
```

## 手動觸發

到 GitHub repo 的 **Actions → Daily news to Telegram → Run workflow** 即可立即執行一次，不需要等到排程時間。

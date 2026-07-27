# LINE 自動新聞推播

每天早上（台灣時間 08:00）自動從 Google 新聞 RSS 抓取最新新聞，並透過 LINE Messaging API 推播給你。

## 運作方式

- `scripts/send-news-to-line.js` 抓取 RSS feed，篩選出上次執行後的新項目，推送到指定的 LINE 使用者。
- `.github/workflows/daily-news-to-line.yml` 每天用 GitHub Actions 排程執行一次（也可以手動觸發 `workflow_dispatch`）。
- `data/state.json` 記錄最後推播過的新聞時間，避免重複推播。

## 設定步驟

### 1. 建立 LINE Messaging API Channel

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)，建立一個 Provider 與 Messaging API Channel。
2. 在 Channel 設定的「Messaging API」分頁：
   - 產生並複製 **Channel access token (long-lived)**。
   - 用手機掃描 QR Code，把這個官方帳號加為好友。
3. 取得你的 **User ID**：
   - 在同一個 Messaging API 分頁的「Basic settings」找不到個人 User ID，需要透過 Webhook 取得。最簡單的方式：
     - 在 Channel 設定中開啟 Webhook，並設定一個暫時的 Webhook URL（可用 [webhook.site](https://webhook.site) 之類的服務先抓一次事件）。
     - 用剛加好友的帳號傳一則訊息給官方帳號，Webhook 收到的事件內容裡的 `source.userId` 就是你的 User ID。
   - 或使用 LINE 官方帳號後台（LINE Official Account Manager）的「進階設定」查詢。

### 2. 設定 GitHub Secrets

到這個 repo 的 **Settings → Secrets and variables → Actions**，新增：

| Secret 名稱 | 說明 |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | 上一步取得的 Channel access token |
| `LINE_USER_ID` | 上一步取得的 User ID |

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
LINE_CHANNEL_ACCESS_TOKEN=xxx LINE_USER_ID=xxx npm run send-news
```

## 手動觸發

到 GitHub repo 的 **Actions → Daily news to LINE → Run workflow** 即可立即執行一次，不需要等到排程時間。

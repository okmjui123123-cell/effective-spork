/**
 * LINE AI 助手 — Cloudflare Worker
 *
 * 收到 LINE 的訊息後交給 Cloudflare Workers AI 產生回覆，
 * 再用 LINE 的「回覆訊息」(reply) API 回傳。
 *
 * 兩邊都是免費的：
 *   - LINE 的回覆訊息不計入免費方案的每月推播額度
 *   - Workers AI 免費方案每天有 10,000 neurons，用完只會回錯誤，不會被收費
 *
 * 需要的環境變數（在 Cloudflare 後台設為 Secret）：
 *   LINE_CHANNEL_SECRET        — 驗證 webhook 來源
 *   LINE_CHANNEL_ACCESS_TOKEN  — 呼叫 LINE reply API
 *
 * 需要的 binding：
 *   AI — Workers AI（在 Settings → Bindings 新增）
 *
 * 選用的 KV binding（沒綁定時就變成單次問答、不記得前文）：
 *   CHAT_HISTORY — 記住每個使用者最近幾輪對話
 *
 * 這支程式刻意寫成單一檔案、不依賴 npm 套件，
 * 這樣可以直接貼到 Cloudflare 後台編輯器部署，不需要安裝任何工具。
 */

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

// 小模型比較省 neurons，免費額度能撐比較多則訊息
const MODEL = "@cf/meta/llama-3.2-3b-instruct";
const MAX_TOKENS = 512;
const LINE_MAX_TEXT_LENGTH = 5000;

// 記住最近幾則訊息（使用者 + 助手各算一則），以及保留多久
const MAX_HISTORY_MESSAGES = 20;
const HISTORY_TTL_SECONDS = 60 * 60 * 24;

const SYSTEM_PROMPT = `你是一個透過 LINE 跟使用者對話的個人助理。

回答規則：
- 一律使用繁體中文（台灣用語）
- 簡潔直接，控制在 LINE 訊息好讀的長度，通常三到五句話以內
- 不要使用 Markdown 語法（LINE 不會渲染），需要條列時用「・」開頭
- 不確定的事情就說不確定，不要編造
- 使用者問的若是需要即時資料（今天股價、現在天氣等），說明你沒有即時資料來源`;

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("LINE AI assistant is running.", { status: 200 });
    }

    const body = await request.text();
    const signature = request.headers.get("x-line-signature");

    if (!(await isValidSignature(body, signature, env.LINE_CHANNEL_SECRET))) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    for (const event of payload.events ?? []) {
      if (event.type === "message" && event.message?.type === "text") {
        // 先回 200 給 LINE，避免 webhook 逾時；實際處理在背景繼續跑
        ctx.waitUntil(handleTextMessage(event, env));
      }
    }

    return new Response("OK", { status: 200 });
  },
};

async function isValidSignature(body, signature, channelSecret) {
  if (!signature || !channelSecret) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function handleTextMessage(event, env) {
  const userId = event.source?.userId;
  const userText = event.message.text;

  try {
    const history = await loadHistory(env, userId);
    const messages = [...history, { role: "user", content: userText }];

    const reply = await askAI(messages, env);

    await replyToLine(event.replyToken, reply, env);
    await saveHistory(env, userId, [
      ...messages,
      { role: "assistant", content: reply },
    ]);
  } catch (err) {
    console.error("handleTextMessage failed:", err);
    await replyToLine(event.replyToken, errorMessageFor(err), env).catch(
      (replyErr) => console.error("error reply failed:", replyErr)
    );
  }
}

async function askAI(messages, env) {
  const result = await env.AI.run(MODEL, {
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    max_tokens: MAX_TOKENS,
  });

  const text = (result?.response ?? "").trim();
  return text || "（沒有產生回覆內容，請再試一次）";
}

function errorMessageFor(err) {
  // Workers AI 免費額度用完時會丟 4006，每天 UTC 00:00（台灣時間早上 8 點）重置
  if (String(err).includes("4006")) {
    return "今天的免費 AI 額度用完了，台灣時間明天早上 8 點會重置，再來找我聊。";
  }
  return "抱歉，剛剛出了點狀況，請再傳一次訊息試試。";
}

async function replyToLine(replyToken, text, env) {
  const response = await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: text.slice(0, LINE_MAX_TEXT_LENGTH) }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LINE reply failed (${response.status}): ${errorBody}`);
  }
}

async function loadHistory(env, userId) {
  if (!env.CHAT_HISTORY || !userId) return [];

  try {
    const raw = await env.CHAT_HISTORY.get(`history:${userId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("loadHistory failed:", err);
    return [];
  }
}

async function saveHistory(env, userId, messages) {
  if (!env.CHAT_HISTORY || !userId) return;

  try {
    await env.CHAT_HISTORY.put(
      `history:${userId}`,
      JSON.stringify(messages.slice(-MAX_HISTORY_MESSAGES)),
      { expirationTtl: HISTORY_TTL_SECONDS }
    );
  } catch (err) {
    console.error("saveHistory failed:", err);
  }
}

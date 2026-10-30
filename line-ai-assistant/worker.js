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
- 訊息裡若附有「即時資料」，一律以那份資料為準來回答，不要用你記憶中的舊資料
- 沒有附即時資料、而問題需要即時資訊時（例如股價），說明你沒有那項資料的來源`;

// --- 即時天氣 ---------------------------------------------------------------
// 資料來源 Open-Meteo，免費且不需要申請金鑰

const WEATHER_API_URL = "https://api.open-meteo.com/v1/forecast";

const WEATHER_KEYWORDS = [
  "天氣", "氣溫", "溫度", "幾度", "下雨", "降雨", "雨傘",
  "冷不冷", "熱不熱", "會冷", "會熱", "寒流", "颱風", "紫外線",
];

// 問句沒指定地點時，預設用第一筆
const LOCATIONS = [
  { name: "彰化", lat: 24.0518, lon: 120.5161 },
  { name: "台北", lat: 25.033, lon: 121.5654 },
  { name: "新北", lat: 25.0169, lon: 121.4628 },
  { name: "桃園", lat: 24.9936, lon: 121.301 },
  { name: "新竹", lat: 24.8138, lon: 120.9675 },
  { name: "苗栗", lat: 24.5602, lon: 120.8214 },
  { name: "台中", lat: 24.1477, lon: 120.6736 },
  { name: "南投", lat: 23.9609, lon: 120.9719 },
  { name: "雲林", lat: 23.7092, lon: 120.4313 },
  { name: "嘉義", lat: 23.4801, lon: 120.4491 },
  { name: "台南", lat: 22.9999, lon: 120.2269 },
  { name: "高雄", lat: 22.6273, lon: 120.3014 },
  { name: "屏東", lat: 22.5519, lon: 120.5487 },
  { name: "基隆", lat: 25.1276, lon: 121.7392 },
  { name: "宜蘭", lat: 24.7021, lon: 121.7378 },
  { name: "花蓮", lat: 23.9871, lon: 121.6015 },
  { name: "台東", lat: 22.7583, lon: 121.1444 },
  { name: "澎湖", lat: 23.5711, lon: 119.5793 },
  { name: "金門", lat: 24.4321, lon: 118.3171 },
];

// WMO weather code 對照表
const WEATHER_CODES = {
  0: "晴朗", 1: "大致晴朗", 2: "多雲時晴", 3: "陰天",
  45: "有霧", 48: "凍霧",
  51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨較大",
  56: "凍毛毛雨", 57: "凍毛毛雨",
  61: "小雨", 63: "中雨", 65: "大雨",
  66: "凍雨", 67: "凍雨",
  71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
  80: "短暫陣雨", 81: "陣雨", 82: "強陣雨",
  85: "陣雪", 86: "強陣雪",
  95: "雷雨", 96: "雷雨伴冰雹", 99: "劇烈雷雨伴冰雹",
};

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

    // 即時資料只放進這次的 system prompt，不存進對話記錄，免得下次拿到過期的數字
    const liveData = await fetchLiveData(userText);
    const reply = await askAI(messages, env, liveData);

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

async function askAI(messages, env, liveData) {
  const system = liveData
    ? `${SYSTEM_PROMPT}\n\n【即時資料】\n${liveData}`
    : SYSTEM_PROMPT;

  const result = await env.AI.run(MODEL, {
    messages: [{ role: "system", content: system }, ...messages],
    max_tokens: MAX_TOKENS,
  });

  const text = (result?.response ?? "").trim();
  return text || "（沒有產生回覆內容，請再試一次）";
}

/**
 * 看使用者的問題需不需要即時資料，需要的話去查回來。
 * 查詢失敗不會中斷對話，只是這次沒有即時資料可用。
 */
async function fetchLiveData(userText) {
  const location = matchWeatherRequest(userText);
  if (!location) return null;

  try {
    return await fetchWeather(location);
  } catch (err) {
    console.error("fetchWeather failed:", err);
    return null;
  }
}

function matchWeatherRequest(text) {
  const normalized = text.replace(/臺/g, "台");

  if (!WEATHER_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return null;
  }

  return (
    LOCATIONS.find((location) => normalized.includes(location.name)) ??
    LOCATIONS[0]
  );
}

async function fetchWeather(location) {
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    current: "temperature_2m,relative_humidity_2m,precipitation,weather_code",
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    timezone: "Asia/Taipei",
    forecast_days: "3",
  });

  const response = await fetch(`${WEATHER_API_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo failed (${response.status})`);
  }

  return formatWeather(location, await response.json());
}

function formatWeather(location, data) {
  const lines = [`${location.name}天氣（資料來源 Open-Meteo）`];

  const current = data?.current;
  if (current) {
    const parts = [`目前 ${describeCode(current.weather_code)}`];
    if (current.temperature_2m != null) {
      parts.push(`氣溫 ${Math.round(current.temperature_2m)} 度`);
    }
    if (current.relative_humidity_2m != null) {
      parts.push(`濕度 ${Math.round(current.relative_humidity_2m)}%`);
    }
    if (current.precipitation != null) {
      parts.push(`降雨量 ${current.precipitation} 毫米`);
    }
    lines.push(parts.join("、"));
  }

  const daily = data?.daily;
  const days = daily?.time ?? [];
  for (let i = 0; i < days.length; i++) {
    const label = ["今天", "明天", "後天"][i] ?? days[i];
    const parts = [describeCode(daily.weather_code?.[i])];

    const low = daily.temperature_2m_min?.[i];
    const high = daily.temperature_2m_max?.[i];
    if (low != null && high != null) {
      parts.push(`${Math.round(low)} 到 ${Math.round(high)} 度`);
    }

    const rain = daily.precipitation_probability_max?.[i];
    if (rain != null) {
      parts.push(`降雨機率 ${rain}%`);
    }

    lines.push(`${label}：${parts.join("、")}`);
  }

  return lines.join("\n");
}

function describeCode(code) {
  return WEATHER_CODES[code] ?? "天氣狀況不明";
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

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import Parser from "rss-parser";

const RSS_URL =
  process.env.RSS_URL || "https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MAX_ITEMS = Number(process.env.MAX_ITEMS || 10);
const STATE_FILE = path.resolve("data/state.json");
const TELEGRAM_MAX_TEXT_LENGTH = 4096;

async function readState() {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { lastPubDate: null };
  }
}

async function writeState(state) {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function formatItem(item) {
  return `${item.title}\n${item.link}`;
}

function chunkText(fullText) {
  const chunks = [];
  let remaining = fullText;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, TELEGRAM_MAX_TEXT_LENGTH));
    remaining = remaining.slice(TELEGRAM_MAX_TEXT_LENGTH);
  }
  return chunks;
}

async function sendToTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  for (const chunk of chunkText(text)) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: chunk,
        disable_web_page_preview: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram sendMessage failed (${response.status}): ${body}`);
    }
  }
}

async function main() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error(
      "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID environment variables."
    );
  }

  const state = await readState();
  const lastPubDate = state.lastPubDate ? new Date(state.lastPubDate) : null;

  const parser = new Parser();
  const feed = await parser.parseURL(RSS_URL);

  const items = feed.items
    .filter((item) => item.pubDate && item.title && item.link)
    .map((item) => ({ ...item, pubDateObj: new Date(item.pubDate) }))
    .filter((item) => !lastPubDate || item.pubDateObj > lastPubDate)
    .sort((a, b) => a.pubDateObj - b.pubDateObj)
    .slice(-MAX_ITEMS);

  if (items.length === 0) {
    console.log("No new news items since last run.");
    return;
  }

  const text = items.map(formatItem).join("\n\n");
  await sendToTelegram(text);

  const newestPubDate = items[items.length - 1].pubDateObj.toISOString();
  await writeState({ lastPubDate: newestPubDate });

  console.log(`Sent ${items.length} news item(s) to Telegram.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

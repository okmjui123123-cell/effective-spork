import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import Parser from "rss-parser";

const RSS_URL =
  process.env.RSS_URL || "https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;
const MAX_ITEMS = Number(process.env.MAX_ITEMS || 10);
const STATE_FILE = path.resolve("data/state.json");
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_MAX_MESSAGES_PER_PUSH = 5;
const LINE_MAX_TEXT_LENGTH = 5000;

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
    chunks.push(remaining.slice(0, LINE_MAX_TEXT_LENGTH));
    remaining = remaining.slice(LINE_MAX_TEXT_LENGTH);
  }
  return chunks;
}

async function pushToLine(text) {
  const messages = chunkText(text)
    .slice(0, LINE_MAX_MESSAGES_PER_PUSH)
    .map((t) => ({ type: "text", text: t }));

  const response = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: LINE_USER_ID, messages }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE push failed (${response.status}): ${body}`);
  }
}

async function main() {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_USER_ID) {
    throw new Error(
      "Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_USER_ID environment variables."
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
  await pushToLine(text);

  const newestPubDate = items[items.length - 1].pubDateObj.toISOString();
  await writeState({ lastPubDate: newestPubDate });

  console.log(`Sent ${items.length} news item(s) to LINE.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * check-secret.mjs — 发布安全闸门
 *
 * 在 git push / npm publish 前检查 lib/client.js 是否携带本地密钥
 * （EMBEDDED_KEY 非空），防止 sk- 密钥泄露到公开仓库/npm。
 *
 * 用法：
 *   node scripts/check-secret.mjs          # 检查默认路径
 *   node scripts/check-secret.mjs <file>   # 检查指定文件
 *
 * 退出码：0 = 干净可发布；1 = 检测到密钥，阻止发布。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.argv[2] || "lib/client.js");

if (!existsSync(file)) {
  console.error(`[check-secret] 文件不存在: ${file}`);
  process.exit(1);
}

const src = readFileSync(file, "utf8");
const match = src.match(/EMBEDDED_KEY\s*=\s*"([^"]*)"/);
const key = match ? match[1] : "";

if (key && /^sk-/.test(key)) {
  console.error("================================================================");
  console.error("  [check-secret] 已拦截发布：检测到本地 API 密钥！");
  console.error("  EMBEDDED_KEY 非空，拒绝 commit/push/publish，防止密钥泄露。");
  console.error("  处理方式：");
  console.error("    1. cp lib/client.js /tmp/client.js.key-backup   # 先备份");
  console.error("    2. 把 EMBEDDED_KEY 改为空字符串（仅保留本地备份里的密钥）");
  console.error("    3. 重新 push/publish，完成后从备份恢复");
  console.error("================================================================");
  process.exit(1);
}

console.log(`[check-secret] OK：${file} 无密钥，可以发布。`);

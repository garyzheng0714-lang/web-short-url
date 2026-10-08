#!/usr/bin/env node
// 构建后给 dist/assets 里的文本资源各生成一份 .br 与 .gz，server.js 按 Accept-Encoding 直接发预压缩文件。
// 服务器出口只有约 90KB/s：主包 680KB 原样要 7 秒以上，br 后约 1/4。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "assets");
const TEXT = /\.(js|css|svg|json|txt|map)$/;
let raw = 0;
let br = 0;
for (const name of fs.readdirSync(dir)) {
  if (!TEXT.test(name)) continue;
  const file = path.join(dir, name);
  const buf = fs.readFileSync(file);
  if (buf.length < 1024) continue;
  const b = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  fs.writeFileSync(`${file}.br`, b);
  fs.writeFileSync(`${file}.gz`, zlib.gzipSync(buf, { level: 9 }));
  raw += buf.length;
  br += b.length;
}
console.log(`compressed assets: ${(raw / 1024).toFixed(0)} KB → br ${(br / 1024).toFixed(0)} KB`);

// check.mjs — check.sh 的 Node 等价实现。本机 Remotion 内置 ffmpeg 为精简版（无 rawvideo/ssim/spectrogram 等），
// 故用 image2pipe+png 提取帧、JS 做 PNG 编解码与全部分析。检查项与 check.sh 一致：
// 格式对 spec / 首帧闪色 / 声音响度与频谱 / 运动曲线 spike / 接触表与关键帧静图。
// 用法: PATH="$PWD/.bin:$PATH" TIMES="2 6.5 9.5" node scripts/check.mjs [out/film.mp4]
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import zlib from 'node:zlib';

// Remotion 内置精简版 ffmpeg/ffprobe（本机无系统 ffmpeg）；可用 FFMPEG/FFPROBE 环境变量覆盖。
const COMP = 'node_modules/@remotion/compositor-win32-x64-msvc/';
const FFMPEG = process.env.FFMPEG ?? (existsSync(COMP + 'ffmpeg.exe') ? COMP + 'ffmpeg.exe' : 'ffmpeg');
const FFPROBE = process.env.FFPROBE ?? (existsSync(COMP + 'ffprobe.exe') ? COMP + 'ffprobe.exe' : 'ffprobe');

const input = process.argv[2] ?? 'out/film.mp4';
const out = 'out/check';
mkdirSync(out, {recursive: true});
const ff = (args) => execFileSync(FFMPEG, ['-loglevel', 'error', ...args], {maxBuffer: 1 << 29});
const fp = (args) => execFileSync(FFPROBE, ['-v', 'error', ...args], {encoding: 'utf8'}).trim();
let fail = 0;
const FAIL = (m) => { console.log('  FAIL ' + m); fail++; };

// ---- minimal PNG codec (8-bit gray/rgb) ----
const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
const pngEncode = (w, h, rgb) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 3)] = 0; rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
const pngDecode = (buf) => {
  let off = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8); const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = ct === 0 ? 1 : 3, bpp = ch, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (1 + stride)], ro = y * (1 + stride) + 1, po = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[po + x - bpp] : 0, b = y > 0 ? px[po - stride + x] : 0, c = x >= bpp && y > 0 ? px[po - stride + x - bpp] : 0;
      let v = raw[ro + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c);
      px[po + x] = v & 0xff;
    }
  }
  return {w, h, ch, data: px};
};
const splitPng = (buf) => {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const frames = [];
  let i = 0;
  while ((i = buf.indexOf(sig, i)) !== -1) {
    let off = i + 8;
    while (off < buf.length) { const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8); off += 12 + len; if (type === 'IEND') break; }
    frames.push(buf.subarray(i, off)); i = off;
  }
  return frames;
};
const grabFrames = (vf, count) => {
  const args = ['-i', input, '-vf', vf, '-f', 'image2pipe', '-c:v', 'png', '-'];
  if (count) args.splice(2, 0, '-frames:v', String(count));
  return splitPng(ff(args)).map(pngDecode);
};

// 1. format vs spec
const specSrc = readFileSync('src/spec.ts', 'utf8');
const filmBlock = /FILM\s*=\s*\{([^}]*)\}/.exec(specSrc)?.[1] ?? '';
const spec = (k) => new RegExp(`${k}:\\s*([0-9.a-z]+)`).exec(filmBlock)?.[1];
const D = parseFloat(fp(['-show_entries', 'format=duration', '-of', 'csv=p=0', input]));
const W = parseInt(fp(['-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', input]));
const H = parseInt(fp(['-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', input]));
const [fn, fd] = fp(['-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', input]).split('/').map(Number);
const FPS = Math.round(fn / (fd || 1));
const hasAudio = fp(['-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', input]).includes('audio');
console.log(`format: ${W}x${H} ${FPS}fps ${D.toFixed(2)}s audio=${hasAudio}`);
if (spec('width') && +spec('width') !== W) FAIL(`width ${W}, spec says ${spec('width')}`);
if (spec('height') && +spec('height') !== H) FAIL(`height ${H}, spec says ${spec('height')}`);
if (spec('fps') && +spec('fps') !== FPS) FAIL(`fps ${FPS}, spec says ${spec('fps')}`);
if (spec('duration') && Math.abs(D - +spec('duration')) > 0.1) FAIL(`duration ${D}, spec says ${spec('duration')}`);
if (spec('sound') === 'true' && !hasAudio) FAIL('spec has sound: true but the video has no audio');
if (specSrc.includes("title: 'TITLE'")) FAIL('src/spec.ts is still the starter placeholder');
if (!fail) console.log('  format matches spec.ts');

// 2. frame 0 flash
const f0 = grabFrames('crop=60:60:30:30,scale=1:1,format=rgb24', 1)[0];
const f1 = (() => { const a = ['-ss', '1', '-i', input, '-frames:v', '1', '-vf', 'crop=60:60:30:30,scale=1:1,format=rgb24', '-f', 'image2pipe', '-c:v', 'png', '-']; return pngDecode(splitPng(ff(a))[0]); })();
const dd = Math.max(...[0, 1, 2].map((i) => Math.abs(f0.data[i] - f1.data[i])));
if (dd > 6) FAIL(`frame 0 background differs from 1 s (max channel diff ${dd})`);
else console.log(`  frame 0 background matches (rgb ${[...f0.data.subarray(0, 3)].join(',')})`);

// 3. sound
if (hasAudio) {
  const ln = spawnSync(FFMPEG, ['-hide_banner', '-i', input, '-vn', '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], {encoding: 'utf8', maxBuffer: 1 << 28}).stderr;
  const j = JSON.parse(/\{[\s\S]*\}/.exec(ln)[0]);
  console.log(`  loudness: integrated ${j.input_i} LUFS, true peak ${j.input_tp} dBFS, LRA ${j.input_lra}`);
  const wav = ff(['-i', input, '-vn', '-ac', '1', '-ar', '22050', '-f', 'wav', '-']);
  const sr = wav.readUInt32LE(24), n = (wav.length - 44) / 2;
  const X = new Float32Array(n);
  for (let i = 0; i < n; i++) X[i] = wav.readInt16LE(44 + i * 2) / 32768;
  const WIN = 1024, HOP = 512, BINS = WIN / 2, frames = Math.floor((n - WIN) / HOP);
  const hann = Float32Array.from({length: WIN}, (_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / (WIN - 1))));
  const fft = (re, im) => {
    for (let i = 1, j = 0; i < WIN; i++) { let bit = WIN >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= WIN; len <<= 1) { const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < WIN; i += len) { let cwr = 1, cwi = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi, vi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const nwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = nwr; } } }
  };
  const SW = 1200, SH = 240, img = Buffer.alloc(SW * SH * 3);
  const re = new Float32Array(WIN), im = new Float32Array(WIN), fMin = 40, fMax = sr / 2;
  for (let fx = 0; fx < SW; fx++) {
    const f0i = Math.floor((fx / SW) * frames);
    for (let i = 0; i < WIN; i++) { re[i] = X[f0i * HOP + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let fy = 0; fy < SH; fy++) {
      const f = fMin * Math.pow(fMax / fMin, 1 - fy / SH), bin = Math.min(BINS - 1, Math.round((f / sr) * WIN));
      const db = 20 * Math.log10(Math.hypot(re[bin], im[bin]) / WIN + 1e-9);
      const v = Math.max(0, Math.min(255, ((db + 70) / 70) * 255)), o = (fy * SW + fx) * 3;
      img[o] = v; img[o + 1] = v * 0.92; img[o + 2] = v * 0.78;
    }
  }
  writeFileSync(`${out}/audio.png`, pngEncode(SW, SH, img));
  console.log(`  spectrogram: ${out}/audio.png`);
}

// 4. motion curve
const mf = grabFrames('scale=192:108,format=gray');
const per = [];
for (let i = 1; i < mf.length; i++) { let s = 0; const a = mf[i - 1].data, b = mf[i].data; for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]); per.push(s / a.length); }
const HALF = Math.max(1, Math.round(FPS / 2)), buckets = [];
for (let i = 0; i < per.length; i += HALF) buckets.push(per.slice(i, i + HALF).reduce((s, v) => s + v, 0) / HALF);
const sorted = [...buckets].sort((a, b) => a - b);
let med = sorted[Math.floor(sorted.length / 2)] || 0; if (med < 0.05) med = 0.05;
console.log(`motion per 0.5 s (mean |frame diff|, 0-255), ${mf.length} frames:`);
buckets.forEach((v, i) => { const t = i * 0.5; const flag = v > 4 * med && v > 1 ? '  <-- spike' : v < 0.005 ? '  (still)' : ''; console.log(`${t.toFixed(1).padStart(6)}s ${v.toFixed(2).padStart(6)}${flag}`); });
console.log(`median ${med.toFixed(2)} — spike must be a planned hit; long (still) run = dead spot`);

// 5. contact sheet + stills
const tw = 480, th = 270, sheet = Buffer.alloc(tw * 4 * th * 3 * 3);
for (let i = 0; i < 12; i++) {
  const t = ((i + 0.5) / 12) * D;
  const f = pngDecode(splitPng(ff(['-ss', t.toFixed(2), '-i', input, '-frames:v', '1', '-vf', `scale=${tw}:${th},format=rgb24`, '-f', 'image2pipe', '-c:v', 'png', '-']))[0]);
  const ox = (i % 4) * tw, oy = Math.floor(i / 4) * th;
  for (let y = 0; y < th; y++) f.data.copy(sheet, ((oy + y) * tw * 4 + ox) * 3, y * tw * 3, (y + 1) * tw * 3);
}
writeFileSync(`${out}/sheet.png`, pngEncode(tw * 4, th * 3, sheet));
const times = [0, ...(process.env.TIMES ?? '').split(/\s+/).filter(Boolean).map(Number), D / 2, D - 0.05];
for (const t of times) ff(['-y', '-ss', t.toFixed(2), '-i', input, '-frames:v', '1', '-vf', 'scale=960:-1', `${out}/f-${t.toFixed(2)}.png`]);
console.log(`stills: ${out} (sheet.png + ${times.length} key frames)`);
console.log(fail ? `${fail} FAIL(s)` : 'all checks passed');
process.exit(fail ? 1 : 0);
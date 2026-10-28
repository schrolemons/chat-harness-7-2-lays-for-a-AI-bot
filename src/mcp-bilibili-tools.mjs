import { z } from 'zod';

const TOOL_NAMES = ['bili_search', 'bili_video_info', 'bili_video_content', 'bili_video_frames', 'bili_analyze_video'];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BLOCKS = 12;
// Leave room for metadata/subtitle requests and packaging around FFmpeg's default 180s limit.
const LONG_VIDEO_TOOL_TIMEOUT_MS = 240_000;
const bv = z.string().regex(/^BV[0-9A-Za-z]{10}$/i);

export const BILIBILI_MCP_SCHEMAS = {
  bili_search: z.object({
    token: z.string().min(1).max(256).describe('当前会话令牌，使用唤醒提示中提供的值'),
    keyword: z.string().trim().min(1).max(100),
    page: z.number().int().min(1).max(20).optional(),
    sort: z.enum(['relevance', 'play', 'pubdate']).optional(),
    excludeBvids: z.array(bv).max(100).optional()
  }).strict(),
  bili_video_info: z.object({ token: z.string().min(1).max(256), video: z.string().trim().min(1).max(2048), page: z.number().int().min(1).max(100).optional() }).strict(),
  bili_video_content: z.object({ token: z.string().min(1).max(256), video: z.string().trim().min(1).max(2048), page: z.number().int().min(1).max(100).optional(), includeComments: z.boolean().optional() }).strict(),
  bili_video_frames: z.object({
    token: z.string().min(1).max(256), video: z.string().trim().min(1).max(2048), page: z.number().int().min(1).max(100).optional(),
    startSeconds: z.number().min(0).optional(), endSeconds: z.number().min(0.1).optional(),
    frameCount: z.number().int().min(1).max(18).optional(), width: z.number().int().min(320).max(1280).optional(),
    sampleMode: z.enum(['scene', 'interval']).optional(), subtitleStrip: z.boolean().optional()
  }).strict(),
  bili_analyze_video: z.object({
    token: z.string().min(1).max(256), video: z.string().trim().min(1).max(2048), question: z.string().max(1000).optional(),
    page: z.number().int().min(1).max(100).optional(), startSeconds: z.number().min(0).optional(), endSeconds: z.number().min(0.1).optional(),
    frameCount: z.number().int().min(1).max(18).optional(), width: z.number().int().min(320).max(1280).optional(),
    sampleMode: z.enum(['scene', 'interval']).optional(), includeComments: z.boolean().optional(), subtitleStrip: z.boolean().optional()
  }).strict()
};

function cleanImageData(value) {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_BYTES * 1.4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  return { data: value, bytes: bytes.length };
}

function imageLabel(sheet, index, kind = '视频关键帧拼图') {
  const range = sheet.range ?? {};
  const rangeLabel = Number.isFinite(range.startSeconds) && Number.isFinite(range.endSeconds)
    ? `${range.startSeconds}s–${range.endSeconds}s` : `第 ${index + 1} 段`;
  const times = Array.isArray(sheet.frameTimestamps) ? sheet.frameTimestamps.map(t => `${Number(t)}s`).join('、') : '';
  return `${kind}（${rangeLabel}；帧时间：${times || '未提供'}）`;
}

export function biliResultToMcp(result) {
  if (!result || typeof result !== 'object') return { content: [{ type: 'text', text: 'Bilibili 工具返回了无效结果' }], isError: true };
  if (result.status === 'error') {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', code: String(result.code ?? 'BILIBILI_ERROR'), error: String(result.error ?? '请求失败').slice(0, 500) }) }], isError: true };
  }
  const data = structuredClone(result);
  const imageParts = [];
  const labels = [];
  let totalBytes = 0;
  const groups = [data.contactSheets, data.frames?.contactSheets].filter(Array.isArray);
  const seenSheets = new Set();
  for (const sheets of groups) {
    for (const [index, sheet] of sheets.entries()) {
      if (!sheet || seenSheets.has(sheet)) continue;
      seenSheets.add(sheet);
      const label = imageLabel(sheet, index);
      const image = cleanImageData(sheet.base64);
      delete sheet.base64;
      if (image && imageParts.length < MAX_IMAGE_BLOCKS && totalBytes + image.bytes <= MAX_TOTAL_IMAGE_BYTES) {
        imageParts.push({ type: 'image', data: image.data, mimeType: 'image/jpeg' });
        totalBytes += image.bytes;
        labels.push(label);
      } else if (sheet.bytes || sheet.base64) {
        data.imageWarning = '部分拼图超过 MCP 返回的大小或数量上限，已省略';
      }
      if (sheet.subtitleStrip && typeof sheet.subtitleStrip === 'object') {
        const strip = cleanImageData(sheet.subtitleStrip.base64);
        delete sheet.subtitleStrip.base64;
        if (strip && imageParts.length < MAX_IMAGE_BLOCKS && totalBytes + strip.bytes <= MAX_TOTAL_IMAGE_BYTES) {
          imageParts.push({ type: 'image', data: strip.data, mimeType: 'image/jpeg' });
          totalBytes += strip.bytes;
          labels.push(imageLabel(sheet, index, '视频硬字幕条拼图'));
        } else if (sheet.subtitleStrip.bytes) data.imageWarning = '字幕条拼图超过 MCP 返回的大小或数量上限，已省略';
      }
    }
  }
  if (labels.length) data.imageEvidence = labels;
  const content = [{ type: 'text', text: JSON.stringify(data) }, ...imageParts];
  return { content };
}

export function registerBilibiliTools(server, { enabled = true, agentApi } = {}) {
  if (!enabled || typeof agentApi !== 'function') return [];
  const descriptions = {
    bili_search: '匿名搜索 Bilibili 公开视频。重复搜索时用 excludeBvids 去重；返回 BV 号、标题、UP 主、简介、时长、发布时间、播放量和链接。',
    bili_video_info: '读取公开视频元数据和分 P/CID，不下载视频。支持 BV、AV、标准链接和 b23.tv 短链。',
    bili_video_content: '读取公开视频字幕和时间戳，可选少量热评；评论作为观众观点单独返回。无字幕时会报告 ASR 是否可用。',
    bili_video_frames: '对公开视频按时间段使用宿主 FFmpeg 抽帧，返回带时间戳的拼图。长视频按返回的剩余时间段继续调用。',
    bili_analyze_video: '组合元数据、字幕、可选热评和视频拼图，供当前视觉模型分析；工具不替模型生成画面结论。'
  };
  for (const name of TOOL_NAMES) {
    server.registerTool(name, {
      description: descriptions[name],
      inputSchema: BILIBILI_MCP_SCHEMAS[name],
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    }, async input => {
      const { token, ...toolInput } = input;
      try {
        const timeoutMs = name === 'bili_video_frames' || name === 'bili_analyze_video'
          ? LONG_VIDEO_TOOL_TIMEOUT_MS
          : undefined;
        const response = await agentApi('/api/plugins/call', {
          method: 'POST',
          body: JSON.stringify({ tool: name, input: toolInput }),
          headers: { 'x-agent-token': token },
          ...(timeoutMs ? { timeoutMs } : {})
        });
        if (!response?.ok || !response.result) throw new Error('Bilibili 组件未启用或没有返回结果');
        return biliResultToMcp(response.result);
      } catch (error) {
        return { content: [{ type: 'text', text: `Bilibili 工具调用失败：${String(error?.message ?? error).slice(0, 500)}` }], isError: true };
      }
    });
  }
  return [...TOOL_NAMES];
}

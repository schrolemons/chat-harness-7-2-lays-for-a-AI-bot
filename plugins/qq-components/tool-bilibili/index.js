import { createBiliRuntime } from './lib/bili-runtime.mjs';
const recommendationURL=new URL('./lib/recommendations.mjs',import.meta.url);recommendationURL.search=new URL(import.meta.url).search;
const {createRecommendationService}=await import(recommendationURL.href);

export const BILI_TOOL_SCHEMAS = {
  bili_search: {
    type: 'object', additionalProperties: false, required: ['keyword'],
    properties: {
      keyword: { type: 'string', minLength: 1, maxLength: 100, description: '由 AI 根据用户问题生成的搜索词' },
      page: { type: 'integer', minimum: 1, maximum: 20, default: 1 },
      sort: { type: 'string', enum: ['relevance', 'play', 'pubdate'], default: 'relevance' },
      excludeBvids: { type: 'array', maxItems: 100, items: { type: 'string', pattern: '^BV[0-9A-Za-z]{10}$' }, description: '本轮之前已见过、需要从结果中排除的 BV 号' }
    }
  },
  bili_video_info: {
    type: 'object', additionalProperties: false, required: ['video'],
    properties: {
      video: { type: 'string', minLength: 1, maxLength: 2048, description: 'BV 号、AV 号、Bilibili 视频链接或 b23.tv 短链接' },
      page: { type: 'integer', minimum: 1, maximum: 100, description: '可选分 P；默认使用链接中的 p 参数或第 1 P' }
    }
  },
  bili_video_content: {
    type: 'object', additionalProperties: false, required: ['video'],
    properties: {
      video: { type: 'string', minLength: 1, maxLength: 2048 },
      page: { type: 'integer', minimum: 1, maximum: 100 },
      includeComments: { type: 'boolean', default: false, description: '按需读取少量公开热评，始终单独标记为观众观点' }
    }
  },
  bili_video_frames: {
    type: 'object', additionalProperties: false, required: ['video'],
    properties: {
      video: { type: 'string', minLength: 1, maxLength: 2048 },
      page: { type: 'integer', minimum: 1, maximum: 100 },
      startSeconds: { type: 'number', minimum: 0 },
      endSeconds: { type: 'number', minimum: 0.1 },
      frameCount: { type: 'integer', minimum: 1, maximum: 18 },
      width: { type: 'integer', minimum: 320, maximum: 1280 },
      sampleMode: { type: 'string', enum: ['scene', 'interval'], default: 'scene' },
      subtitleStrip: { type: 'boolean', default: false }
    }
  },
  bili_analyze_video: {
    type: 'object', additionalProperties: false, required: ['video'],
    properties: {
      video: { type: 'string', minLength: 1, maxLength: 2048 },
      question: { type: 'string', maxLength: 1000, description: '用户的问题或分析目标' },
      page: { type: 'integer', minimum: 1, maximum: 100 },
      startSeconds: { type: 'number', minimum: 0 },
      endSeconds: { type: 'number', minimum: 0.1 },
      frameCount: { type: 'integer', minimum: 1, maximum: 18 },
      width: { type: 'integer', minimum: 320, maximum: 1280 },
      sampleMode: { type: 'string', enum: ['scene', 'interval'], default: 'scene' },
      includeComments: { type: 'boolean', default: false },
      subtitleStrip: { type: 'boolean', default: false }
    }
  }
};

const DESCRIPTIONS = {
  bili_search: '匿名搜索 Bilibili 公开视频。可按相关度、播放量或发布时间排序；多轮改词时把已见 BV 号放进 excludeBvids 去重。返回来源链接。只读。',
  bili_video_info: '读取公开视频的标题、简介、UP 主、封面、时长、分 P/CID 等元数据；支持 BV、AV、标准链接及 b23.tv 短链，不下载视频。只读。',
  bili_video_content: '读取所选分 P 的公开字幕与时间戳；无字幕时明确报告 ASR 不可用。可选读取少量热评，但评论始终是观众观点，不是视频事实。只读。',
  bili_video_frames: '读取允许访问的视频流并由受控 FFmpeg 按场景变化或等间隔抽帧，返回带时间范围/帧时间的拼图。长视频默认只处理一个时间段；需要更多片段时继续指定时间范围。不会接受下载 URL、系统命令或文件路径。只读。',
  bili_analyze_video: '组合元数据、公开视频字幕、可选热评和带时间戳的 FFmpeg 关键帧，供当前视觉模型分析；工具本身不生成视觉结论。请区分直接观察、字幕、观众评论、推断和不确定信息。只读。'
};

export function createPlugin(ctx, dependencies = {}) {
  const runtime = dependencies.runtime ?? createBiliRuntime({
    config: ctx.config ?? {}, root: ctx.root, signal: ctx.signal,
    ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
    ...(dependencies.runFfmpeg ? { runFfmpeg: dependencies.runFfmpeg } : {}),
    ...(dependencies.fileOps ? { fileOps: dependencies.fileOps } : {}),
    ...(dependencies.client ? { client: dependencies.client } : {}),
    ...(dependencies.cache ? { cache: dependencies.cache } : {}),
    ...(dependencies.frameExtractor ? { frameExtractor: dependencies.frameExtractor } : {}),
    ...(dependencies.now ? { now: dependencies.now } : {})
  });
  const methodByTool = {
    bili_search: 'search', bili_video_info: 'videoInfo', bili_video_content: 'videoContent',
    bili_video_frames: 'videoFrames', bili_analyze_video: 'analyzeVideo'
  };
  for (const [name, method] of Object.entries(methodByTool)) {
    ctx.registerTool(name, {
      description: DESCRIPTIONS[name],
      schema: BILI_TOOL_SCHEMAS[name],
      handler: async input => {
        try { return await runtime.handlers[method](input); }
        catch (error) {
          return { status: 'error', code: String(error?.code ?? 'BILIBILI_ERROR').slice(0, 80), error: String(error?.message ?? error).slice(0, 500) };
        }
      }
    });
  }
  return { services:{biliRecommendations:createRecommendationService(ctx,{search:runtime.handlers.search,random:dependencies.random,now:dependencies.now})},dispose: () => runtime.dispose() };
}

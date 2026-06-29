"use strict";

const $ = (selector) => document.querySelector(selector);

const state = {
  chromaImage: null,
  resizeImage: null,
  interpolateAImage: null,
  interpolateBImage: null,
  videoUrl: null,
  frames: [],
  selectedFrameId: null,
  pickingColor: false,
  animationFrameIndex: 0,
  animationTimer: null,
  animationPlaying: false,
  batchItems: [],
  trimImage: null,
  trimMetadata: null,
  pixelScaleImage: null,
  truePixelFile: null,
  truePixelImage: null,
  truePixelBlob: null,
  truePixelMetadata: null,
  truePixelToken: 0,
  sequenceItems: [],
  atlasSliceImage: null,
  atlasSlices: [],
  atlasDrag: null,
  atlasHover: null,
  selectedAtlasSliceIndex: -1,
  editorDrawing: false,
  editorPointer: null,
  editorZoomWidth: null,
  unityApkInspection: null,
  unityApkInspectToken: 0,
  rankingFetchToken: 0,
};

const statusText = $("#statusText");
const toolMeta = {
  chromaPanel: {
    name: "抠背景",
    desc: "处理绿幕、品红底、蓝底或自定义纯色背景。",
    use: "透明 PNG 处理",
    useDesc: "用于快速扣除纯色背景，输出可直接进入引擎或图集流程的透明素材。",
    input: "图片文件",
    inputDesc: "选择本地 PNG、JPG、WebP 等浏览器可读取的图片。",
    output: "PNG",
    outputDesc: "保留透明通道，适合 UI、特效、道具图和序列帧资源。",
  },
  resizePanel: {
    name: "改尺寸",
    desc: "按指定宽高、比例或最长边快速生成游戏素材尺寸。",
    use: "尺寸适配",
    useDesc: "快速生成图标、UI、纹理、商店素材等不同分辨率版本。",
    input: "图片文件",
    inputDesc: "载入后会自动读取原始宽高，避免手动查尺寸。",
    output: "PNG",
    outputDesc: "按当前模式输出指定宽高、比例或最长边限制后的图片。",
  },
  interpolatePanel: {
    name: "图片插帧",
    desc: "输入前后两帧，生成一张轻量中间过渡帧。",
    use: "轻量补帧",
    useDesc: "适合小尺寸特效、UI 动效和简单 sprite 序列补一张过渡帧。",
    input: "两张图片",
    inputDesc: "分别选择前一帧和后一帧，输出尺寸按第一帧对齐。",
    output: "中间帧 PNG",
    outputDesc: "使用透明安全混合，尽量避免透明 PNG 边缘发黑。",
  },
  videoPanel: {
    name: "视频抽帧",
    desc: "从视频中抽取帧图，预览帧动画并导出图集。",
    use: "视频转序列帧",
    useDesc: "从动作预览、特效视频或录屏中抽取帧，并可同步扣背景。",
    input: "视频文件",
    inputDesc: "支持浏览器可解码的视频格式，按时间间隔抽帧。",
    output: "PNG 序列 / 图集",
    outputDesc: "可导出选中帧，也可以把所有帧打包成图集和 JSON。",
  },
  batchPanel: {
    name: "批量队列",
    desc: "多张图片按同一规则批量处理，适合 AI 批产素材后的统一清理。",
    use: "批量自动化",
    useDesc: "把多张图加入队列后统一裁边或像素缩放，减少重复操作。",
    input: "多张图片",
    inputDesc: "支持一次选择多张 PNG、JPG、WebP 等图片。",
    output: "处理后的 PNG",
    outputDesc: "可逐张导出，也能配合 API 批量打包成 ZIP。",
  },
  trimPanel: {
    name: "裁透明边",
    desc: "自动裁掉透明 PNG 四周空白，并生成 offset 元数据。",
    use: "Sprite 清理",
    useDesc: "常用于特效帧、道具图和 UI 图标去掉无效透明边。",
    input: "透明图片",
    inputDesc: "读取 alpha 通道，按阈值判断有效像素范围。",
    output: "PNG + JSON",
    outputDesc: "输出裁剪结果和原图尺寸、偏移、裁剪框数据。",
  },
  pixelScalePanel: {
    name: "像素缩放",
    desc: "使用最近邻采样放大或缩小像素风图片，保持硬边。",
    use: "像素资源适配",
    useDesc: "适合 16x16、32x32、64x64 等像素素材整数倍导出。",
    input: "像素图片",
    inputDesc: "导入小尺寸图标、角色帧、tile 或 UI 像素图。",
    output: "PNG",
    outputDesc: "按倍数输出最近邻缩放后的清晰像素图。",
  },
  truePixelPanel: {
    name: "真像素化",
    desc: "把 AI 生成的伪像素图重采样成真实像素网格，去掉柔边和半像素渐变。",
    use: "AI 像素图清理",
    useDesc: "适合把高分辨率 AI 像素风角色、道具或背景转成可进引擎的硬边像素素材。",
    input: "AI 生成图片",
    inputDesc: "导入 PNG、JPG、WebP 等图片，工具会按网格块重新采样。",
    output: "真像素 PNG",
    outputDesc: "输出低色数、最近邻放大的 PNG，每个像素块都是硬边色块。",
  },
  pixelEditorPanel: {
    name: "像素编辑",
    desc: "轻量编辑像素图，支持画笔、橡皮、取色和透明 PNG 导出。",
    use: "快速修图",
    useDesc: "用于修补 AI 生成小图、画 32x32 草稿或调整单帧像素。",
    input: "新建或导入",
    inputDesc: "可新建固定尺寸画布，也可导入已有图片继续编辑。",
    output: "透明 PNG",
    outputDesc: "导出保留透明通道的像素图片。",
  },
  sequencePanel: {
    name: "序列重命名",
    desc: "整理序列帧顺序，统一补零命名并输出清单。",
    use: "帧序列整理",
    useDesc: "适合把散乱帧图整理成引擎和动画工具易读的命名。",
    input: "多张帧图",
    inputDesc: "支持自然排序、文件名排序和反向排序。",
    output: "重命名 PNG",
    outputDesc: "逐张导出重命名结果，也可导出 manifest.json。",
  },
  atlasSlicePanel: {
    name: "图集切割",
    desc: "导入未知 sprite sheet，按网格切割并手动调整单元参数。",
    use: "反向拆图集",
    useDesc: "从已有图集、截图或旧资源中拆出独立 sprite 帧。",
    input: "图集图片",
    inputDesc: "通过行列、单元尺寸、边距和间隔描述切割规则。",
    output: "PNG 序列 + JSON",
    outputDesc: "按切片导出单帧，并生成每帧坐标清单。",
  },
};

Object.assign(toolMeta, {
  convertPanel: {
    name: "格式转换",
    desc: "图片格式转换、压缩和最长边限制。",
    use: "格式适配",
    useDesc: "用于商店图、预览图、UI 图和 Web 资源的体积控制。",
    input: "图片文件",
    inputDesc: "选择 PNG、JPG、WebP 等浏览器可读取图片。",
    output: "PNG / WebP / JPG / AVIF",
    outputDesc: "按目标格式导出并保留必要的透明通道或背景填充。",
  },
  atlasPackPanel: {
    name: "图集打包",
    desc: "增强图集打包，支持 padding、extrude、裁边、2 的幂和引擎 manifest。",
    use: "引擎导入",
    useDesc: "适合把散图整理成 Unity、Godot、Cocos、Pixi 可继续使用的图集。",
    input: "多张 Sprite",
    inputDesc: "一次选择序列帧、UI 图标或 tile 小图。",
    output: "Atlas ZIP",
    outputDesc: "包含 atlas.png、atlas.json 和对应引擎预设 JSON。",
  },
  unityApkPanel: {
    name: "Unity APK",
    desc: "扫描 Unity Android 包中的 Data、AssetBundle、IL2CPP metadata，并可调用外部工具还原工程或导出资源。",
    use: "打包后资源检查",
    useDesc: "用于项目打包后回看资源、引用结构、场景/Prefab 还原结果或 IL2CPP 类型信息。",
    input: "APK 文件",
    inputDesc: "选择 Unity 2022+ 或其他版本导出的 Android APK，本地 API 会先做结构分析。",
    output: "Unity 提取 ZIP",
    outputDesc: "包含 manifest.json、原始 Unity 结构；配置外部工具后还会包含 tool-output。",
  },
  spriteFxPanel: {
    name: "Sprite 增强",
    desc: "透明边缘修复、描边、投影、调色、调色板压色、法线图和遮罩图。",
    use: "单图增强",
    useDesc: "用于清理抠图边缘、生成受击/禁用状态、补充 2D 光照贴图。",
    input: "单张 Sprite",
    inputDesc: "选择需要修饰或生成贴图的透明 PNG。",
    output: "PNG",
    outputDesc: "导出处理后的透明 PNG 或贴图。",
  },
  pipelinePanel: {
    name: "流水线工具",
    desc: "序列帧动图、九宫格、tileset、素材质检和批量调色。",
    use: "批处理检查",
    useDesc: "把常见资产整理动作集中到一个高频面板里。",
    input: "图片或序列帧",
    inputDesc: "根据功能选择单图、多图或序列帧。",
    output: "ZIP / 动图 / 报告",
    outputDesc: "导出可交付文件，或在页面中查看质检 JSON。",
  },
  audioPanel: {
    name: "音频工具",
    desc: "游戏音效和 BGM 转码、码率控制与响度标准化。",
    use: "音频适配",
    useDesc: "把音效快速整理成引擎常用格式。",
    input: "音频文件",
    inputDesc: "选择 wav、mp3、ogg、m4a 等音频。",
    output: "OGG / MP3 / WAV / M4A",
    outputDesc: "使用本地 ffmpeg 导出处理结果。",
  },
});

const toolGroups = [
  {
    name: "图片清理",
    desc: "透明背景、裁边和基础图片修整。",
    panels: ["chromaPanel", "trimPanel"],
  },
  {
    name: "尺寸缩放",
    desc: "普通素材尺寸适配和像素风最近邻缩放。",
    panels: ["resizePanel", "pixelScalePanel"],
  },
  {
    name: "像素制作",
    desc: "AI 伪像素清理、小尺寸像素图修补、绘制和透明 PNG 导出。",
    panels: ["truePixelPanel", "pixelEditorPanel"],
  },
  {
    name: "动画帧",
    desc: "图片插帧、视频抽帧和帧动画预览。",
    panels: ["interpolatePanel", "videoPanel"],
  },
  {
    name: "序列图集",
    desc: "序列帧命名整理和未知图集反向切割。",
    panels: ["sequencePanel", "atlasSlicePanel"],
  },
  {
    name: "批量处理",
    desc: "多张素材按统一规则进入队列处理。",
    panels: ["batchPanel"],
  },
  {
    name: "导出与引擎",
    desc: "格式转换、增强图集和引擎 manifest。",
    panels: ["convertPanel", "atlasPackPanel", "unityApkPanel"],
  },
  {
    name: "增强与质检",
    desc: "Sprite 增强、流水线检查和音频处理。",
    panels: ["spriteFxPanel", "pipelinePanel", "audioPanel"],
  },
];

function setStatus(message) {
  if (statusText) {
    statusText.textContent = message;
  }
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be loaded."));
    };
    image.src = url;
  });
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be loaded."));
    };
    image.src = url;
  });
}

function isImageInputFile(file) {
  return Boolean(file && (file.type?.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name || "")));
}

function bindFileDropzone(dropzone, options = {}) {
  if (!dropzone) return;
  const acceptFile = options.acceptFile || (() => true);
  const leave = () => dropzone.classList.remove("is-drag-over");
  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.add("is-drag-over");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
  });
  ["dragleave", "dragend"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      leave();
    });
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    leave();
    const file = [...(event.dataTransfer?.files || [])].find(acceptFile);
    if (!file) {
      if (typeof options.onInvalid === "function") options.onInvalid();
      return;
    }
    Promise.resolve(options.onFile?.(file)).catch((error) => {
      if (typeof options.onError === "function") {
        options.onError(error);
      } else {
        console.error(error);
      }
    });
  });
}

function fitCanvasToImage(canvas, image) {
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function drawImageToCanvas(canvas, image, width, height) {
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function drawContainedImage(canvas, image) {
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function colorDistance(r, g, b, key) {
  const dr = r - key.r;
  const dg = g - key.g;
  const db = b - key.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function smoothStep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function estimateBackgroundColorFromImageData(imageData) {
  const { width, height, data } = imageData;
  const samples = [];
  const radius = Math.max(1, Math.min(4, Math.floor(Math.min(width, height) / 24)));
  const anchors = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  anchors.forEach(([anchorX, anchorY]) => {
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        const x = Math.max(0, Math.min(width - 1, anchorX + ox));
        const y = Math.max(0, Math.min(height - 1, anchorY + oy));
        const index = (y * width + x) * 4;
        samples.push([data[index], data[index + 1], data[index + 2]]);
      }
    }
  });
  const median = (channel) => {
    const values = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] || 0;
  };
  return { r: median(0), g: median(1), b: median(2) };
}

function suppressDominantSpill(r, g, b, key, strength, mask) {
  if (strength <= 0 || mask <= 0) return { r, g, b };
  const channels = [r, g, b];
  const keyChannels = [key.r, key.g, key.b];
  const dominant = keyChannels.indexOf(Math.max(...keyChannels));
  const sortedKey = [...keyChannels].sort((a, b) => b - a);
  if (sortedKey[0] - sortedKey[1] < 36) return { r, g, b };
  const otherIndices = [0, 1, 2].filter((index) => index !== dominant);
  const otherMax = Math.max(channels[otherIndices[0]], channels[otherIndices[1]]);
  const excess = Math.max(0, channels[dominant] - otherMax);
  channels[dominant] -= excess * strength * mask;
  return { r: clampChannel(channels[0]), g: clampChannel(channels[1]), b: clampChannel(channels[2]) };
}

function boxFilterFloat(values, width, height, radius) {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const integralRow = (y + 1) * (width + 1);
    const previousRow = y * (width + 1);
    for (let x = 0; x < width; x += 1) {
      rowSum += values[y * width + x];
      integral[integralRow + x + 1] = integral[previousRow + x + 1] + rowSum;
    }
  }
  const output = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const a = y0 * (width + 1) + x0;
      const b = y0 * (width + 1) + x1 + 1;
      const c = (y1 + 1) * (width + 1) + x0;
      const d = (y1 + 1) * (width + 1) + x1 + 1;
      output[y * width + x] = (integral[d] - integral[b] - integral[c] + integral[a]) / area;
    }
  }
  return output;
}

function guidedFilterAlphaSingleChannel(data, width, height, alpha, radius, epsilon, guideSelector) {
  const count = width * height;
  const guide = new Float32Array(count);
  const guideAlpha = new Float32Array(count);
  const guideGuide = new Float32Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    const i = pixel * 4;
    const guideValue = guideSelector(data[i], data[i + 1], data[i + 2]);
    guide[pixel] = guideValue;
    guideAlpha[pixel] = guideValue * alpha[pixel];
    guideGuide[pixel] = guideValue * guideValue;
  }
  const meanGuide = boxFilterFloat(guide, width, height, radius);
  const meanAlpha = boxFilterFloat(alpha, width, height, radius);
  const meanGuideAlpha = boxFilterFloat(guideAlpha, width, height, radius);
  const meanGuideGuide = boxFilterFloat(guideGuide, width, height, radius);
  const a = new Float32Array(count);
  const b = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const covariance = meanGuideAlpha[i] - meanGuide[i] * meanAlpha[i];
    const variance = meanGuideGuide[i] - meanGuide[i] * meanGuide[i];
    a[i] = covariance / (variance + epsilon);
    b[i] = meanAlpha[i] - a[i] * meanGuide[i];
  }
  const meanA = boxFilterFloat(a, width, height, radius);
  const meanB = boxFilterFloat(b, width, height, radius);
  const output = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    output[i] = Math.max(0, Math.min(1, meanA[i] * guide[i] + meanB[i]));
  }
  return output;
}

function guidedFilterAlpha(data, width, height, alpha, radius, epsilon) {
  const luma = guidedFilterAlphaSingleChannel(
    data,
    width,
    height,
    alpha,
    radius,
    epsilon,
    (r, g, b) => (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255,
  );
  const red = guidedFilterAlphaSingleChannel(data, width, height, alpha, radius, epsilon, (r) => r / 255);
  const green = guidedFilterAlphaSingleChannel(data, width, height, alpha, radius, epsilon, (r, g) => g / 255);
  const blue = guidedFilterAlphaSingleChannel(data, width, height, alpha, radius, epsilon, (r, g, b) => b / 255);
  const output = new Float32Array(alpha.length);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = Math.max(0, Math.min(1, luma[i] * 0.52 + red[i] * 0.16 + green[i] * 0.16 + blue[i] * 0.16));
  }
  return output;
}

function refineAlphaWithAutoTrimap(data, width, height, alpha, distance, options) {
  const enabled = options.matting !== false;
  const strength = Math.max(0, Math.min(1, Number(options.mattingStrength ?? 70) / 100));
  if (!enabled || strength <= 0) return alpha;
  const radius = Math.max(1, Math.min(32, Math.round(Number(options.mattingRadius ?? 4))));
  const refined = guidedFilterAlpha(data, width, height, alpha, radius, 0.0008);
  const output = new Float32Array(alpha.length);
  const foregroundLock = options.tolerance + options.softness * 1.35;
  const backgroundLock = Math.max(0, options.fadeStart * 0.72);
  for (let i = 0; i < alpha.length; i += 1) {
    if (alpha[i] <= 0.015 || distance[i] <= backgroundLock) {
      output[i] = 0;
    } else if (alpha[i] >= 0.985 && distance[i] >= foregroundLock) {
      output[i] = 1;
    } else {
      output[i] = Math.max(0, Math.min(1, alpha[i] * (1 - strength) + refined[i] * strength));
    }
  }
  return output;
}

function decontaminateEdgeColors(data, key, refinedAlpha, distance, options) {
  const spill = Math.max(0, Math.min(1, Number(options.spill ?? 85) / 100));
  if (spill <= 0) return;
  const spillRange = Math.max(1, options.tolerance + options.softness * 2 + 24);

  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    const alpha = refinedAlpha[pixel];
    if (alpha <= 0.01) continue;
    const nearKey = Math.max(0, 1 - distance[pixel] / spillRange);
    const edgeMask = Math.max(1 - alpha, nearKey * 0.6);
    const blend = Math.min(0.92, spill * edgeMask);
    if (blend <= 0) continue;

    const safeAlpha = Math.max(0.08, alpha);
    const recoveredR = (data[i] - key.r * (1 - safeAlpha)) / safeAlpha;
    const recoveredG = (data[i + 1] - key.g * (1 - safeAlpha)) / safeAlpha;
    const recoveredB = (data[i + 2] - key.b * (1 - safeAlpha)) / safeAlpha;
    data[i] = clampChannel(data[i] * (1 - blend) + recoveredR * blend);
    data[i + 1] = clampChannel(data[i + 1] * (1 - blend) + recoveredG * blend);
    data[i + 2] = clampChannel(data[i + 2] * (1 - blend) + recoveredB * blend);

    const suppressed = suppressDominantSpill(data[i], data[i + 1], data[i + 2], key, spill, nearKey);
    data[i] = suppressed.r;
    data[i + 1] = suppressed.g;
    data[i + 2] = suppressed.b;
  }
}

function applyChromaToImageData(imageData, keyColor, tolerance, softness, options = {}) {
  const data = imageData.data;
  const key = keyColor === "auto" ? estimateBackgroundColorFromImageData(imageData) : keyColor;
  const fadeStart = Math.max(0, tolerance - softness);
  const fadeRange = Math.max(1, tolerance - fadeStart);
  const spill = Math.max(0, Math.min(1, Number(options.spill ?? 85) / 100));
  const edgeCleanup = Math.max(0, Math.min(1, Number(options.edgeCleanup ?? 18) / 100));
  const spillRange = tolerance + softness * 2 + 24;
  const edgeFloor = edgeCleanup * 0.22;
  const alpha = new Float32Array(imageData.width * imageData.height);
  const distanceMap = new Float32Array(alpha.length);

  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    const distance = colorDistance(data[i], data[i + 1], data[i + 2], key);
    distanceMap[pixel] = distance;
    let matte = 1;
    if (distance <= fadeStart) {
      matte = 0;
    } else if (distance < tolerance) {
      matte = smoothStep(fadeStart, tolerance, distance);
    }
    if (edgeCleanup > 0 && matte > 0 && matte < 1) {
      matte = matte <= edgeFloor ? 0 : (matte - edgeFloor) / (1 - edgeFloor);
    }
    const finalAlpha = Math.max(0, Math.min(1, (data[i + 3] / 255) * matte));
    if (finalAlpha > 0 && spill > 0) {
      const mask = Math.max(1 - matte, Math.max(0, 1 - distance / Math.max(1, spillRange)));
      if (mask > 0) {
        const safeAlpha = Math.max(0.06, finalAlpha);
        const recoveredR = (data[i] - key.r * (1 - safeAlpha)) / safeAlpha;
        const recoveredG = (data[i + 1] - key.g * (1 - safeAlpha)) / safeAlpha;
        const recoveredB = (data[i + 2] - key.b * (1 - safeAlpha)) / safeAlpha;
        const blend = spill * mask;
        data[i] = clampChannel(data[i] * (1 - blend) + recoveredR * blend);
        data[i + 1] = clampChannel(data[i + 1] * (1 - blend) + recoveredG * blend);
        data[i + 2] = clampChannel(data[i + 2] * (1 - blend) + recoveredB * blend);
      }
      const nearKey = Math.max(0, 1 - distance / Math.max(1, spillRange));
      const dominantMask = distance < spillRange ? 1 : 0;
      const suppressed = suppressDominantSpill(data[i], data[i + 1], data[i + 2], key, spill, dominantMask);
      data[i] = suppressed.r;
      data[i + 1] = suppressed.g;
      data[i + 2] = suppressed.b;
    }
    alpha[pixel] = finalAlpha;
  }

  const refinedAlpha = refineAlphaWithAutoTrimap(data, imageData.width, imageData.height, alpha, distanceMap, {
    ...options,
    fadeStart,
    tolerance,
    softness,
  });
  decontaminateEdgeColors(data, key, refinedAlpha, distanceMap, {
    ...options,
    tolerance,
    softness,
  });
  for (let i = 3, pixel = 0; i < data.length; i += 4, pixel += 1) {
    data[i] = clampChannel(refinedAlpha[pixel] * 255);
  }

  return imageData;
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function setKeyColor(hexColor) {
  $("#keyPreset").value = "custom";
  $("#customKeyColor").value = hexColor.toLowerCase();
  applyChromaKey();
}

function chromaKeyFromControls(presetId, colorId) {
  const preset = $(`#${presetId}`).value;
  if (preset === "auto") return "auto";
  return hexToRgb(preset === "custom" ? $(`#${colorId}`).value : preset);
}

function setCanvasPickMode(active) {
  state.pickingColor = active;
  $("#eyedropperButton").classList.toggle("active", active);
  $("#chromaSourceCanvas").classList.toggle("is-picking-color", active);
}

function pickColorFromSourceCanvas(event) {
  if (!state.pickingColor || !state.chromaImage) return;

  const canvas = $("#chromaSourceCanvas");
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height);

  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;

  const [r, g, b] = canvas.getContext("2d", { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
  const hexColor = rgbToHex(r, g, b);
  setCanvasPickMode(false);
  setKeyColor(hexColor);
  setStatus(`已吸取颜色 ${hexColor}`);
}

async function startEyedropper() {
  if ("EyeDropper" in window) {
    try {
      const result = await new EyeDropper().open();
      setKeyColor(result.sRGBHex);
      setStatus(`已吸取颜色 ${result.sRGBHex}`);
    } catch (error) {
      if (error.name !== "AbortError") setStatus("吸管取色失败");
    }
    return;
  }

  if (!state.chromaImage) {
    setStatus("请先载入图片，再点击原图取色");
    return;
  }

  setCanvasPickMode(true);
  setStatus("点击原图中的背景颜色");
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) {
      setStatus("导出失败");
      return;
    }
    downloadBlob(blob, filename);
  }, "image/png");
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

function selectedFiles(id) {
  return [...($(`#${id}`)?.files || [])];
}

function setText(id, value) {
  const element = $(`#${id}`);
  if (element) element.textContent = value;
}

function appendFiles(formData, field, files) {
  files.forEach((file) => formData.append(field, file, file.name));
}

async function apiDownload(endpoint, formData, fallbackName, statusId) {
  setText(statusId, "处理中...");
  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });
  const blob = await response.blob();
  if (!response.ok) {
    const message = await blob.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  downloadBlob(blob, filename);
  setText(statusId, `已导出 ${filename}`);
  setStatus(`已导出 ${filename}`);
}

async function apiJson(endpoint, formData) {
  const options = formData ? { method: "POST", body: formData } : {};
  const response = await fetch(endpoint, options);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${endpoint} ${response.status}: ${message || response.statusText}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatChineseDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

async function downloadResponseBlob(endpoint, fallbackName) {
  const response = await fetch(endpoint);
  const blob = await response.blob();
  if (!response.ok) {
    const message = await blob.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  downloadBlob(blob, filename);
  return filename;
}

function canvasToBlob(canvas, type = "image/png") {
  return new Promise((resolve) => canvas.toBlob(resolve, type));
}

function downloadJson(data, filename) {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename);
}

function naturalCompare(a, b) {
  return a.localeCompare(b, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function loadImageItem(file, index) {
  const image = await loadImageFromFile(file);
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name || `image_${String(index + 1).padStart(4, "0")}.png`,
    image,
    resultCanvas: null,
    resultName: null,
    metadata: null,
  };
}

function getTrimBounds(imageData, alphaThreshold = 8) {
  const { width, height, data } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width: 1, height: 1, empty: true };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    empty: false,
  };
}

function trimImageToCanvas(image, options = {}) {
  const alphaThreshold = Math.max(0, Math.min(255, Number(options.alphaThreshold ?? 8)));
  const padding = Math.max(0, Number(options.padding ?? 0));
  const source = document.createElement("canvas");
  fitCanvasToImage(source, image);
  const ctx = source.getContext("2d", { willReadFrequently: true });
  const bounds = getTrimBounds(ctx.getImageData(0, 0, source.width, source.height), alphaThreshold);
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const right = Math.min(source.width, bounds.x + bounds.width + padding);
  const bottom = Math.min(source.height, bounds.y + bounds.height + padding);
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);
  const result = document.createElement("canvas");
  result.width = width;
  result.height = height;
  result.getContext("2d").drawImage(source, x, y, width, height, 0, 0, width, height);
  const metadata = {
    originalWidth: source.width,
    originalHeight: source.height,
    x,
    y,
    width,
    height,
    offsetX: x,
    offsetY: y,
    empty: bounds.empty,
  };
  return { canvas: result, metadata };
}

function pixelScaleImageToCanvas(image, factor = 2) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.max(0.25, Math.min(16, Number(factor) || 1));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

function copyCanvas(source, target) {
  target.width = source.width;
  target.height = source.height;
  const ctx = target.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(source, 0, 0);
}

async function downloadCanvasAs(canvas, filename) {
  const blob = await canvasToBlob(canvas);
  if (blob) downloadBlob(blob, filename);
}

function replaceExtension(name, suffix = "", extension = "png") {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}${suffix}.${extension}`;
}

function sortFiles(files, mode = "natural") {
  const list = [...files];
  list.sort((a, b) => (mode === "name" ? a.name.localeCompare(b.name) : naturalCompare(a.name, b.name)));
  if (mode === "reverse") list.reverse();
  return list;
}

function updateInterpolateButtons() {
  const ready = Boolean(state.interpolateAImage && state.interpolateBImage);
  $("#generateInterpolate").disabled = !ready;
  $("#downloadInterpolate").disabled = !ready || $("#interpolateResultCanvas").width === 0;
}

function drawImageToImageData(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function interpolatePixelData(frameA, frameB, t, mode) {
  const output = new ImageData(frameA.width, frameA.height);
  const a = frameA.data;
  const b = frameB.data;
  const out = output.data;
  const useNearest = mode === "nearest";
  const weightA = useNearest ? (t < 0.5 ? 1 : 0) : 1 - t;
  const weightB = useNearest ? (t >= 0.5 ? 1 : 0) : t;

  for (let i = 0; i < out.length; i += 4) {
    const alphaA = a[i + 3] / 255;
    const alphaB = b[i + 3] / 255;
    const alpha = alphaA * weightA + alphaB * weightB;

    if (alpha <= 0.0001) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }

    out[i] = Math.round((a[i] * alphaA * weightA + b[i] * alphaB * weightB) / alpha);
    out[i + 1] = Math.round((a[i + 1] * alphaA * weightA + b[i + 1] * alphaB * weightB) / alpha);
    out[i + 2] = Math.round((a[i + 2] * alphaA * weightA + b[i + 2] * alphaB * weightB) / alpha);
    out[i + 3] = Math.round(alpha * 255);
  }

  return output;
}

function generateInterpolatedFrame() {
  if (!state.interpolateAImage || !state.interpolateBImage) return;

  const width = state.interpolateAImage.naturalWidth || state.interpolateAImage.width;
  const height = state.interpolateAImage.naturalHeight || state.interpolateAImage.height;
  const frameA = drawImageToImageData(state.interpolateAImage, width, height);
  const frameB = drawImageToImageData(state.interpolateBImage, width, height);
  const t = Number($("#interpolateT").value);
  const mode = $("#interpolateMode").value;
  const result = interpolatePixelData(frameA, frameB, t, mode);
  const canvas = $("#interpolateResultCanvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d", { willReadFrequently: true }).putImageData(result, 0, 0);
  $("#downloadInterpolate").disabled = false;
  setStatus(`已生成插帧 ${width}x${height}`);
}

function applyChromaKey() {
  if (!state.chromaImage) return;

  const source = $("#chromaSourceCanvas");
  const result = $("#chromaResultCanvas");
  fitCanvasToImage(source, state.chromaImage);

  result.width = source.width;
  result.height = source.height;

  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  const resultCtx = result.getContext("2d", { willReadFrequently: true });
  const imageData = sourceCtx.getImageData(0, 0, source.width, source.height);
  const keyColor = chromaKeyFromControls("keyPreset", "customKeyColor");
  const tolerance = Number($("#keyTolerance").value);
  const softness = Number($("#softness").value);
  applyChromaToImageData(imageData, keyColor, tolerance, softness, {
    spill: Number($("#spillStrength")?.value || 85),
    edgeCleanup: Number($("#edgeCleanup")?.value || 18),
    mattingStrength: Number($("#mattingStrength")?.value || 70),
    mattingRadius: Number($("#mattingRadius")?.value || 4),
  });

  resultCtx.clearRect(0, 0, result.width, result.height);
  resultCtx.putImageData(imageData, 0, 0);
  $("#downloadChroma").disabled = false;
  setStatus(`已处理 ${result.width}x${result.height}`);
}

function updateChromaPreviewBackground() {
  const preview = $("#chromaResultPreview");
  const input = $("#chromaPreviewBackground");
  if (!preview || !input) return;
  preview.style.setProperty("--chroma-preview-background", input.value || "#101827");
}

function updateResizeControls() {
  const mode = $("#resizeMode").value;
  $("#resizeWidth").disabled = mode !== "exact";
  $("#resizeHeight").disabled = mode !== "exact";
  $("#resizeScale").disabled = mode !== "scale";
  $("#resizeMaxSide").disabled = mode !== "maxSide";
  document.querySelectorAll("[data-resize-group]").forEach((group) => {
    group.classList.toggle("hidden", group.dataset.resizeGroup !== mode);
  });
}

function updateVideoChromaControls() {
  const enabled = $("#videoChromaEnabled").checked;
  document.querySelector(".video-chroma-fields")?.classList.toggle("hidden", !enabled);
}

function applyResize() {
  if (!state.resizeImage) return;

  const source = $("#resizeSourceCanvas");
  const result = $("#resizeResultCanvas");
  fitCanvasToImage(source, state.resizeImage);

  const originalWidth = state.resizeImage.naturalWidth || state.resizeImage.width;
  const originalHeight = state.resizeImage.naturalHeight || state.resizeImage.height;
  let width = Number($("#resizeWidth").value);
  let height = Number($("#resizeHeight").value);
  const mode = $("#resizeMode").value;

  if (mode === "scale") {
    const scale = Math.max(1, Number($("#resizeScale").value)) / 100;
    width = originalWidth * scale;
    height = originalHeight * scale;
  }

  if (mode === "maxSide") {
    const maxSide = Math.max(1, Number($("#resizeMaxSide").value));
    const ratio = Math.min(1, maxSide / Math.max(originalWidth, originalHeight));
    width = originalWidth * ratio;
    height = originalHeight * ratio;
  }

  drawImageToCanvas(result, state.resizeImage, width, height);
  $("#resizeResultLabel").textContent = `处理结果 ${result.width}x${result.height}`;
  $("#downloadResize").disabled = false;
  setStatus(`已调整为 ${result.width}x${result.height}`);
}

function captureVideoFrame(video, time) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  if ($("#videoChromaEnabled").checked) {
    const keyColor = chromaKeyFromControls("videoKeyPreset", "videoKeyColor");
    const tolerance = Number($("#videoKeyTolerance").value);
    const softness = Number($("#videoSoftness").value);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.putImageData(
      applyChromaToImageData(imageData, keyColor, tolerance, softness, {
        spill: Number($("#videoSpillStrength")?.value || 85),
        edgeCleanup: Number($("#videoEdgeCleanup")?.value || 18),
        mattingStrength: Number($("#videoMattingStrength")?.value || 70),
        mattingRadius: Number($("#videoMattingRadius")?.value || 4),
      }),
      0,
      0,
    );
  }

  const dataUrl = canvas.toDataURL("image/png");
  const image = new Image();
  image.src = dataUrl;
  return {
    id: crypto.randomUUID(),
    time,
    width: canvas.width,
    height: canvas.height,
    dataUrl,
    image,
  };
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const clean = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      clean();
      resolve();
    };
    const onError = () => {
      clean();
      reject(new Error("Video seek failed."));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = Math.min(Math.max(0, time), video.duration || 0);
  });
}

function updateFrameButtons() {
  const hasFrames = state.frames.length > 0;
  const hasSelected = Boolean(state.selectedFrameId);
  $("#clearFrames").disabled = !hasFrames;
  $("#downloadAtlas").disabled = !hasFrames;
  $("#downloadSelectedFrame").disabled = !hasSelected;
  $("#toggleAnimation").disabled = !hasFrames;
  $("#resetAnimation").disabled = !hasFrames;
  $("#frameSummary").textContent = hasFrames
    ? `已抽取 ${state.frames.length} 帧，点击缩略图可选中。`
    : "还没有抽取帧。";
}

function stopFrameAnimation() {
  if (state.animationTimer) {
    clearInterval(state.animationTimer);
    state.animationTimer = null;
  }
  state.animationPlaying = false;
  $("#toggleAnimation").textContent = "播放";
}

function drawAnimationFrame(index = state.animationFrameIndex) {
  const canvas = $("#animationCanvas");
  const ctx = canvas.getContext("2d");

  if (!state.frames.length) {
    canvas.width = 320;
    canvas.height = 180;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    $("#animationFrameLabel").textContent = "0 / 0 帧";
    return;
  }

  const normalizedIndex = Math.max(0, Math.min(index, state.frames.length - 1));
  const frame = state.frames[normalizedIndex];
  const width = Math.max(...state.frames.map((item) => item.width));
  const height = Math.max(...state.frames.map((item) => item.height));
  canvas.width = width;
  canvas.height = height;

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const x = Math.floor((canvas.width - frame.width) / 2);
    const y = Math.floor((canvas.height - frame.height) / 2);
    ctx.drawImage(frame.image, x, y, frame.width, frame.height);
    $("#animationFrameLabel").textContent = `${normalizedIndex + 1} / ${state.frames.length} 帧 · ${frame.time.toFixed(2)}s`;
  };

  if (frame.image.complete) {
    draw();
  } else {
    frame.image.onload = draw;
  }
}

function syncAnimationPreview() {
  if (!state.frames.length) {
    state.animationFrameIndex = 0;
    stopFrameAnimation();
    drawAnimationFrame();
    return;
  }

  if (state.animationFrameIndex >= state.frames.length) {
    state.animationFrameIndex = 0;
  }

  if (!state.animationPlaying) {
    const selectedIndex = state.frames.findIndex((frame) => frame.id === state.selectedFrameId);
    if (selectedIndex >= 0) state.animationFrameIndex = selectedIndex;
    drawAnimationFrame();
  }
}

function startFrameAnimation() {
  if (!state.frames.length) return;

  stopFrameAnimation();
  state.animationPlaying = true;
  $("#toggleAnimation").textContent = "暂停";

  const fps = Math.max(1, Math.min(60, Number($("#animationFps").value) || 12));
  const interval = 1000 / fps;
  drawAnimationFrame(state.animationFrameIndex);
  state.animationTimer = setInterval(() => {
    state.animationFrameIndex = (state.animationFrameIndex + 1) % state.frames.length;
    drawAnimationFrame(state.animationFrameIndex);
  }, interval);
}

function resetFrameAnimation() {
  stopFrameAnimation();
  state.animationFrameIndex = 0;
  drawAnimationFrame();
}

function renderFrames() {
  const grid = $("#frameGrid");
  const template = $("#frameTemplate");
  grid.innerHTML = "";

  state.frames.forEach((frame, index) => {
    const tile = template.content.firstElementChild.cloneNode(true);
    tile.dataset.id = frame.id;
    tile.classList.toggle("selected", frame.id === state.selectedFrameId);
    tile.querySelector("img").src = frame.dataUrl;
    tile.querySelector("img").alt = `第 ${index + 1} 帧`;
    tile.querySelector("span").textContent = `${index + 1} @ ${frame.time.toFixed(2)}s`;
    tile.addEventListener("click", () => {
      state.selectedFrameId = frame.id;
      state.animationFrameIndex = index;
      renderFrames();
    });
    grid.appendChild(tile);
  });

  updateFrameButtons();
  syncAnimationPreview();
}

async function extractFrames() {
  const video = $("#videoPreview");
  if (!video.src || !Number.isFinite(video.duration) || video.duration <= 0) return;

  const interval = Math.max(0.05, Number($("#frameInterval").value));
  const previousTime = video.currentTime;
  const frames = [];
  $("#extractFrames").disabled = true;
  setStatus("正在抽帧...");

  for (let time = 0; time <= video.duration; time += interval) {
    await seekVideo(video, time);
    frames.push(captureVideoFrame(video, time));
    setStatus(`已抽取 ${frames.length} 帧`);
  }

  await seekVideo(video, previousTime);
  state.frames = frames;
  state.selectedFrameId = frames[0]?.id || null;
  state.animationFrameIndex = 0;
  $("#animationFps").value = Math.max(1, Math.min(60, Math.round(1 / interval)));
  $("#extractFrames").disabled = false;
  renderFrames();
  setStatus(`完成 ${frames.length} 帧`);
}

function captureCurrentFrame() {
  const video = $("#videoPreview");
  if (!video.src || !video.videoWidth) return;
  const frame = captureVideoFrame(video, video.currentTime);
  state.frames.push(frame);
  state.selectedFrameId = frame.id;
  state.animationFrameIndex = state.frames.length - 1;
  renderFrames();
  setStatus(`已截取 ${frame.time.toFixed(2)}s`);
}

async function downloadSelectedFrame() {
  const frame = state.frames.find((item) => item.id === state.selectedFrameId);
  if (!frame) return;
  const response = await fetch(frame.dataUrl);
  const blob = await response.blob();
  downloadBlob(blob, `frame-${frame.time.toFixed(2)}s.png`);
}

async function drawImageDataUrl(ctx, dataUrl, x, y, width, height) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
  ctx.drawImage(image, x, y, width, height);
}

async function downloadAtlas() {
  if (!state.frames.length) return;

  const maxFrameWidth = Math.max(...state.frames.map((frame) => frame.width));
  const maxFrameHeight = Math.max(...state.frames.map((frame) => frame.height));
  const columns = Math.ceil(Math.sqrt(state.frames.length));
  const rows = Math.ceil(state.frames.length / columns);
  const atlas = document.createElement("canvas");
  atlas.width = columns * maxFrameWidth;
  atlas.height = rows * maxFrameHeight;
  const ctx = atlas.getContext("2d");
  ctx.clearRect(0, 0, atlas.width, atlas.height);

  const metadata = {
    image: "atlas.png",
    width: atlas.width,
    height: atlas.height,
    frames: [],
  };

  for (let index = 0; index < state.frames.length; index += 1) {
    const frame = state.frames[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * maxFrameWidth;
    const y = row * maxFrameHeight;
    await drawImageDataUrl(ctx, frame.dataUrl, x, y, frame.width, frame.height);
    metadata.frames.push({
      name: `frame_${String(index + 1).padStart(4, "0")}`,
      time: Number(frame.time.toFixed(4)),
      x,
      y,
      w: frame.width,
      h: frame.height,
    });
  }

  const atlasBlob = await canvasToBlob(atlas);
  downloadBlob(atlasBlob, "atlas.png");
  downloadBlob(
    new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }),
    "atlas.json",
  );
  setStatus(`图集已导出 ${atlas.width}x${atlas.height}`);
}

function renderAssetList(container, items, options = {}) {
  container.innerHTML = "";
  items.forEach((item, index) => {
    const row = document.createElement("article");
    row.className = "asset-row";
    const preview = document.createElement("img");
    preview.alt = "";
    if (item.resultCanvas) {
      preview.src = item.resultCanvas.toDataURL("image/png");
    } else if (item.dataUrl) {
      preview.src = item.dataUrl;
    } else if (item.file) {
      preview.src = URL.createObjectURL(item.file);
    } else {
      preview.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    }
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.resultName || item.newName || item.name || `item_${index + 1}`;
    const detail = document.createElement("span");
    detail.textContent = options.detail?.(item, index) || item.file?.name || "";
    info.append(title, detail);
    row.append(preview, info);
    if (options.withDownload && item.resultCanvas) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "导出";
      button.addEventListener("click", () => downloadCanvasAs(item.resultCanvas, item.resultName));
      row.append(button);
    }
    container.appendChild(row);
  });
}

function batchChromaKeyFromControls() {
  const preset = $("#batchChromaPreset").value;
  if (preset === "auto") return "auto";
  return hexToRgb(preset === "custom" ? $("#batchChromaColor").value : preset);
}

function imageToCanvas(image) {
  const canvas = document.createElement("canvas");
  fitCanvasToImage(canvas, image);
  return canvas;
}

function chromaKeyImageToCanvas(image) {
  const canvas = imageToCanvas(image);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyChromaToImageData(
    imageData,
    batchChromaKeyFromControls(),
    Number($("#batchChromaTolerance").value),
    Number($("#batchChromaSoftness").value),
    {
      spill: Number($("#batchChromaSpill").value),
      edgeCleanup: Number($("#batchChromaEdgeCleanup").value),
      mattingStrength: 70,
      mattingRadius: 4,
    },
  );
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(imageData, 0, 0);
  return {
    canvas,
    metadata: {
      width: canvas.width,
      height: canvas.height,
      tolerance: Number($("#batchChromaTolerance").value),
      softness: Number($("#batchChromaSoftness").value),
    },
  };
}

async function truePixelFileToCanvas(file) {
  const form = new FormData();
  form.append("image", file, file.name);
  form.append("cellSize", $("#batchTruePixelCellSize").value);
  form.append("outputScale", $("#batchTruePixelOutputScale").value);
  form.append("colors", $("#batchTruePixelColors").value);
  form.append("sharpen", $("#batchTruePixelSharpen").value);
  form.append("sampleKernel", $("#batchTruePixelKernel").value);
  form.append("dither", $("#batchTruePixelDither").value);

  const response = await fetch("/api/image/true-pixel", { method: "POST", body: form });
  if (!response.ok) throw new Error(await response.text() || `Request failed: ${response.status}`);
  const blob = await response.blob();
  const encodedMeta = response.headers.get("X-GameAssetForge-Metadata") || "";
  const metadata = encodedMeta ? JSON.parse(atob(encodedMeta)) : {};
  const image = await loadImageFromBlob(blob);
  const canvas = imageToCanvas(image);
  return { canvas, metadata };
}

function updateBatchOperationFields() {
  const operation = $("#batchOperation").value;
  document.querySelectorAll("[data-batch-fields]").forEach((group) => {
    group.classList.toggle("hidden", group.dataset.batchFields !== operation);
  });
}

async function processBatchQueue() {
  const operation = $("#batchOperation").value;
  const alphaThreshold = Number($("#batchTrimAlpha").value);
  const padding = Number($("#batchTrimPadding").value);
  const scaleFactor = Number($("#batchScaleFactor").value);

  $("#processBatch").disabled = true;
  $("#batchSummary").textContent = `正在处理 0 / ${state.batchItems.length} 张图片...`;

  try {
    for (const [index, item] of state.batchItems.entries()) {
      $("#batchSummary").textContent = `正在处理 ${index + 1} / ${state.batchItems.length}: ${item.name}`;
      if (operation === "trim") {
        const { canvas, metadata } = trimImageToCanvas(item.image, { alphaThreshold, padding });
        item.resultCanvas = canvas;
        item.metadata = metadata;
        item.resultName = replaceExtension(item.name, "-trim");
        continue;
      }
      if (operation === "pixelScale") {
        item.resultCanvas = pixelScaleImageToCanvas(item.image, scaleFactor);
        item.metadata = {
          originalWidth: item.image.naturalWidth || item.image.width,
          originalHeight: item.image.naturalHeight || item.image.height,
          width: item.resultCanvas.width,
          height: item.resultCanvas.height,
          scale: scaleFactor,
        };
        item.resultName = replaceExtension(item.name, `-x${scaleFactor}`);
        continue;
      }
      if (operation === "chromaKey") {
        const { canvas, metadata } = chromaKeyImageToCanvas(item.image);
        item.resultCanvas = canvas;
        item.metadata = metadata;
        item.resultName = replaceExtension(item.name, "-keyed");
        continue;
      }
      const { canvas, metadata } = await truePixelFileToCanvas(item.file);
      item.resultCanvas = canvas;
      item.metadata = metadata;
      item.resultName = replaceExtension(item.name, "-true-pixel");
    }
  } catch (error) {
    $("#batchSummary").textContent = error.message;
    throw error;
  } finally {
    $("#processBatch").disabled = !state.batchItems.length;
  }

  $("#downloadBatchAll").disabled = !state.batchItems.length;
  $("#batchSummary").textContent = `已处理 ${state.batchItems.length} 张图片。`;
  renderAssetList($("#batchList"), state.batchItems, {
    withDownload: true,
    detail: (item) => `${item.metadata?.width || 0}x${item.metadata?.height || 0}`,
  });
}

function renderBatchList() {
  $("#batchSummary").textContent = state.batchItems.length
    ? `队列中有 ${state.batchItems.length} 张图片。`
    : "还没有导入图片。";
  $("#processBatch").disabled = !state.batchItems.length;
  $("#downloadBatchAll").disabled = !state.batchItems.some((item) => item.resultCanvas);
  $("#clearBatch").disabled = !state.batchItems.length;
  renderAssetList($("#batchList"), state.batchItems, {
    withDownload: true,
    detail: (item) => item.resultCanvas ? `${item.resultCanvas.width}x${item.resultCanvas.height}` : "等待处理",
  });
}

async function applyTrim() {
  if (!state.trimImage) return;
  const source = $("#trimSourceCanvas");
  fitCanvasToImage(source, state.trimImage);
  const { canvas, metadata } = trimImageToCanvas(state.trimImage, {
    alphaThreshold: Number($("#trimAlphaThreshold").value),
    padding: Number($("#trimPadding").value),
  });
  copyCanvas(canvas, $("#trimResultCanvas"));
  state.trimMetadata = metadata;
  $("#trimMetadata").textContent = JSON.stringify(metadata, null, 2);
  $("#downloadTrim").disabled = false;
  $("#downloadTrimJson").disabled = false;
}

function applyPixelScale() {
  if (!state.pixelScaleImage) return;
  fitCanvasToImage($("#pixelScaleSourceCanvas"), state.pixelScaleImage);
  const result = pixelScaleImageToCanvas(state.pixelScaleImage, Number($("#pixelScaleFactor").value));
  copyCanvas(result, $("#pixelScaleResultCanvas"));
  $("#pixelScaleResultLabel").textContent = `缩放结果 ${result.width}x${result.height}`;
  $("#downloadPixelScale").disabled = false;
}

async function applyTruePixel() {
  if (!state.truePixelFile || !state.truePixelImage) return;
  const token = state.truePixelToken + 1;
  state.truePixelToken = token;
  state.truePixelBlob = null;
  state.truePixelMetadata = null;
  $("#downloadTruePixel").disabled = true;
  fitCanvasToImage($("#truePixelSourceCanvas"), state.truePixelImage);
  setText("truePixelStatus", "正在重采样像素网格...");

  const form = new FormData();
  form.append("image", state.truePixelFile, state.truePixelFile.name);
  form.append("cellSize", $("#truePixelCellSize").value);
  form.append("outputScale", $("#truePixelOutputScale").value);
  form.append("colors", $("#truePixelColors").value);
  form.append("sharpen", $("#truePixelSharpen").value);
  form.append("sampleKernel", $("#truePixelKernel").value);
  form.append("dither", $("#truePixelDither").value);

  try {
    const response = await fetch("/api/image/true-pixel", { method: "POST", body: form });
    const blob = await response.blob();
    if (!response.ok) {
      throw new Error(await blob.text() || `Request failed: ${response.status}`);
    }
    if (token !== state.truePixelToken) return;
    const encodedMeta = response.headers.get("X-GameAssetForge-Metadata") || "";
    const metadata = encodedMeta ? JSON.parse(atob(encodedMeta)) : {};
    const image = await loadImageFromBlob(blob);
    if (token !== state.truePixelToken) return;
    fitCanvasToImage($("#truePixelResultCanvas"), image);
    state.truePixelBlob = blob;
    state.truePixelMetadata = metadata;
    $("#truePixelResultLabel").textContent = `真像素结果 ${metadata.width || image.width}x${metadata.height || image.height}`;
    $("#downloadTruePixel").disabled = false;
    setText(
      "truePixelStatus",
      [
        `原图: ${metadata.originalWidth || 0}x${metadata.originalHeight || 0}`,
        `像素网格: ${metadata.lowWidth || 0}x${metadata.lowHeight || 0}`,
        `输出: ${metadata.width || 0}x${metadata.height || 0}`,
        `块尺寸: ${metadata.cellSize || "-"} / 倍率: ${metadata.outputScale || "-"}`,
        `调色板: ${metadata.colors || "-"} 色 / 抖动: ${metadata.dither ?? "-"}`,
      ].join("\n"),
    );
  } catch (error) {
    if (token === state.truePixelToken) setText("truePixelStatus", error.message);
  }
}

function createEditorCanvas(width = 32, height = 32) {
  const canvas = $("#pixelEditorCanvas");
  canvas.width = Math.max(4, Math.min(128, Math.round(width)));
  canvas.height = Math.max(4, Math.min(128, Math.round(height)));
  canvas.getContext("2d", { willReadFrequently: true }).clearRect(0, 0, canvas.width, canvas.height);
  syncEditorGrid();
}

function syncEditorGrid() {
  const canvas = $("#pixelEditorCanvas");
  const frame = $("#pixelEditorFrame");
  if (!canvas || !frame) return;
  frame.style.setProperty("--editor-cols", canvas.width);
  frame.style.setProperty("--editor-rows", canvas.height);
  frame.style.setProperty("--editor-aspect", `${canvas.width} / ${canvas.height}`);
  updateEditorBrushPreview();
}

function handleEditorWheel(event) {
  const stage = $(".editor-stage");
  const frame = $("#pixelEditorFrame");
  if (!stage || !frame) return;

  if (event.altKey) {
    zoomEditorCanvas(event, stage, frame);
    return;
  }

  if (event.ctrlKey) {
    event.preventDefault();
    stage.scrollLeft += event.deltaY || event.deltaX;
    updateEditorBrushPreview(event);
  }
}

function zoomEditorCanvas(event, stage = $(".editor-stage"), frame = $("#pixelEditorFrame")) {
  if (!stage || !frame) return;
  event.preventDefault();

  const frameRect = frame.getBoundingClientRect();
  if (!frameRect.width || !frameRect.height) return;

  const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  const nextWidth = Math.max(128, Math.min(4096, frameRect.width * zoomFactor));
  const pointerRatioX = Math.max(0, Math.min(1, (event.clientX - frameRect.left) / frameRect.width));
  const pointerRatioY = Math.max(0, Math.min(1, (event.clientY - frameRect.top) / frameRect.height));
  const nextHeight = nextWidth / (frameRect.width / frameRect.height);

  frame.style.width = `${nextWidth}px`;
  state.editorZoomWidth = nextWidth;
  stage.scrollLeft += (nextWidth - frameRect.width) * pointerRatioX;
  stage.scrollTop += (nextHeight - frameRect.height) * pointerRatioY;
  updateEditorBrushPreview(event);
}

function editorPointerToPixel(event) {
  const canvas = $("#pixelEditorCanvas");
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width),
    y: Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height),
  };
}

function paintEditorPixel(event) {
  const canvas = $("#pixelEditorCanvas");
  const { x, y } = editorPointerToPixel(event);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const tool = $("#editorTool").value;
  const size = Math.max(1, Number($("#editorBrushSize").value) || 1);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (tool === "picker") {
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    $("#editorColor").value = rgbToHex(r, g, b);
    $("#editorTool").value = "pen";
    return;
  }

  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
  ctx.fillStyle = $("#editorColor").value;
  ctx.fillRect(x, y, size, size);
  ctx.globalCompositeOperation = "source-over";
}

function updateEditorBrushPreview(event) {
  const canvas = $("#pixelEditorCanvas");
  const preview = $("#editorBrushPreview");
  if (!canvas || !preview) return;

  if (event) {
    state.editorPointer = { x: event.clientX, y: event.clientY };
  }
  if (!state.editorPointer) return;

  const canvasRect = canvas.getBoundingClientRect();
  const stageRect = $(".editor-stage").getBoundingClientRect();
  const point = editorPointerToPixel({
    clientX: state.editorPointer.x,
    clientY: state.editorPointer.y,
  });
  const inside = point.x >= 0 && point.y >= 0 && point.x < canvas.width && point.y < canvas.height;

  preview.classList.toggle("visible", inside);
  if (!inside) return;

  const tool = $("#editorTool").value;
  const brushSize = tool === "picker" ? 1 : Math.max(1, Number($("#editorBrushSize").value) || 1);
  const cellWidth = canvasRect.width / canvas.width;
  const cellHeight = canvasRect.height / canvas.height;
  const left = canvasRect.left - stageRect.left + point.x * cellWidth;
  const top = canvasRect.top - stageRect.top + point.y * cellHeight;

  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
  preview.style.width = `${Math.max(1, brushSize * cellWidth)}px`;
  preview.style.height = `${Math.max(1, brushSize * cellHeight)}px`;
  preview.classList.toggle("eraser", tool === "eraser");
}

function hideEditorBrushPreview() {
  state.editorPointer = null;
  $("#editorBrushPreview")?.classList.remove("visible");
}

function applySequenceRename() {
  const sorted = sortFiles(state.sequenceItems.map((item) => item.file), $("#sequenceSort").value);
  const prefix = $("#sequencePrefix").value.trim() || "frame";
  const start = Number($("#sequenceStart").value) || 0;
  const padding = Math.max(1, Number($("#sequencePadding").value) || 4);
  state.sequenceItems = sorted.map((file, index) => {
    const oldItem = state.sequenceItems.find((item) => item.file === file);
    const number = String(start + index).padStart(padding, "0");
    return {
      ...oldItem,
      file,
      name: file.name,
      newName: `${prefix}_${number}.png`,
    };
  });
  renderSequenceList();
}

function renderSequenceList() {
  $("#sequenceSummary").textContent = state.sequenceItems.length
    ? `${state.sequenceItems.length} 张序列帧。`
    : "还没有导入序列帧。";
  $("#applySequenceRename").disabled = !state.sequenceItems.length;
  $("#downloadSequenceAll").disabled = !state.sequenceItems.length;
  $("#downloadSequenceManifest").disabled = !state.sequenceItems.length;
  renderAssetList($("#sequenceList"), state.sequenceItems, {
    detail: (item) => item.name,
  });
}

function getSequenceManifest() {
  return {
    count: state.sequenceItems.length,
    frames: state.sequenceItems.map((item, index) => ({
      index,
      source: item.name,
      name: item.newName,
    })),
  };
}

function getSliceSettings() {
  return {
    columns: Math.max(1, Number($("#sliceColumns").value) || 1),
    rows: Math.max(1, Number($("#sliceRows").value) || 1),
    cellWidth: Math.max(1, Number($("#sliceCellWidth").value) || 1),
    cellHeight: Math.max(1, Number($("#sliceCellHeight").value) || 1),
    marginX: Math.max(0, Number($("#sliceMarginX").value) || 0),
    marginY: Math.max(0, Number($("#sliceMarginY").value) || 0),
    gapX: Math.max(0, Number($("#sliceGapX").value) || 0),
    gapY: Math.max(0, Number($("#sliceGapY").value) || 0),
  };
}

function imageDataFromImage(image) {
  const canvas = document.createElement("canvas");
  fitCanvasToImage(canvas, image);
  return canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
}

function getCornerBackgroundColor(imageData) {
  const { data, width, height } = imageData;
  const points = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  const sum = points.reduce(
    (acc, [x, y]) => {
      const index = (y * width + x) * 4;
      acc.r += data[index];
      acc.g += data[index + 1];
      acc.b += data[index + 2];
      acc.a += data[index + 3];
      return acc;
    },
    { r: 0, g: 0, b: 0, a: 0 },
  );
  return {
    r: Math.round(sum.r / points.length),
    g: Math.round(sum.g / points.length),
    b: Math.round(sum.b / points.length),
    a: Math.round(sum.a / points.length),
  };
}

function buildAtlasMask(imageData, mode, threshold) {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  const background = getCornerBackgroundColor(imageData);
  let transparentCount = 0;
  let foregroundCount = 0;

  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const index = pixel * 4;
    const alpha = data[index + 3];
    if (alpha <= threshold) transparentCount += 1;

    const dr = data[index] - background.r;
    const dg = data[index + 1] - background.g;
    const db = data[index + 2] - background.b;
    const da = alpha - background.a;
    const colorDistance = Math.sqrt(dr * dr + dg * dg + db * db + da * da);
    const isForeground = mode === "alpha" ? alpha > threshold : colorDistance > threshold;

    if (isForeground) {
      mask[pixel] = 1;
      foregroundCount += 1;
    }
  }

  return { mask, width, height, background, transparentCount, foregroundCount };
}

function connectedBoxesFromMask(mask, width, height, minArea, padding) {
  const visited = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const boxes = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let stackLength = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    stack[0] = start;
    visited[start] = 1;

    while (stackLength) {
      const current = stack[--stackLength];
      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [current - 1, current + 1, current - width, current + width];
      if (x === 0) neighbors[0] = -1;
      if (x === width - 1) neighbors[1] = -1;

      neighbors.forEach((next) => {
        if (next < 0 || next >= mask.length || !mask[next] || visited[next]) return;
        visited[next] = 1;
        stack[stackLength] = next;
        stackLength += 1;
      });
    }

    if (area < minArea) continue;
    const x = Math.max(0, minX - padding);
    const y = Math.max(0, minY - padding);
    const right = Math.min(width - 1, maxX + padding);
    const bottom = Math.min(height - 1, maxY + padding);
    boxes.push({ x, y, w: right - x + 1, h: bottom - y + 1, area });
  }

  return boxes;
}

function runsFromProjection(projection, blankLimit) {
  const runs = [];
  let start = -1;
  projection.forEach((count, index) => {
    const filled = count > blankLimit;
    if (filled && start < 0) start = index;
    if ((!filled || index === projection.length - 1) && start >= 0) {
      const end = filled && index === projection.length - 1 ? index : index - 1;
      if (end >= start) runs.push([start, end]);
      start = -1;
    }
  });
  return runs;
}

function gridBoxesFromMask(mask, width, height, minArea, padding) {
  const columnProjection = Array.from({ length: width }, () => 0);
  const rowProjection = Array.from({ length: height }, () => 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      columnProjection[x] += 1;
      rowProjection[y] += 1;
    }
  }

  const columnRuns = runsFromProjection(columnProjection, Math.max(0, Math.floor(height * 0.01)));
  const rowRuns = runsFromProjection(rowProjection, Math.max(0, Math.floor(width * 0.01)));
  const boxes = [];
  rowRuns.forEach(([top, bottom]) => {
    columnRuns.forEach(([left, right]) => {
      const w = right - left + 1;
      const h = bottom - top + 1;
      if (w * h < minArea) return;
      const x = Math.max(0, left - padding);
      const y = Math.max(0, top - padding);
      boxes.push({
        x,
        y,
        w: Math.min(width - x, w + padding * 2),
        h: Math.min(height - y, h + padding * 2),
      });
    });
  });

  return { boxes, columnRuns, rowRuns };
}

function getAtlasSlicePrefix() {
  const input = $("#sliceNamePrefix");
  return (input?.value || "slice").trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "slice";
}

function renameAtlasSlices() {
  const prefix = getAtlasSlicePrefix();
  state.atlasSlices = state.atlasSlices.map((slice, index) => ({
    ...slice,
    index,
    name: `${prefix}_${String(index + 1).padStart(4, "0")}.png`,
  }));
  renderAtlasSlices();
}

function reindexAtlasSlices() {
  const previousSelected = state.selectedAtlasSliceIndex;
  const prefix = getAtlasSlicePrefix();
  state.atlasSlices = state.atlasSlices.map((slice, index) => ({
    ...slice,
    index,
    name: `${prefix}_${String(index + 1).padStart(4, "0")}.png`,
  }));
  if (!state.atlasSlices.length) {
    state.selectedAtlasSliceIndex = -1;
    return;
  }
  const selected = state.atlasSlices.find((slice) => slice.index === previousSelected);
  state.selectedAtlasSliceIndex = selected?.index ?? state.atlasSlices[Math.min(previousSelected, state.atlasSlices.length - 1)]?.index ?? 0;
}

function boxesToSlices(boxes) {
  const prefix = getAtlasSlicePrefix();
  return [...boxes]
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
    .map((box, index) => ({
      index,
      name: `${prefix}_${String(index + 1).padStart(4, "0")}.png`,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
    }));
}

function renderAtlasSlices(sourceLabel = "图集预览") {
  if (!state.atlasSliceImage) return;
  const canvas = $("#atlasSliceCanvas");
  fitCanvasToImage(canvas, state.atlasSliceImage);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.save();
  ctx.lineWidth = Math.max(1, Math.round(canvas.width / 512));
  state.atlasSlices.forEach((slice) => {
    const selected = slice.index === state.selectedAtlasSliceIndex;
    ctx.strokeStyle = selected ? "#f59e0b" : "#38bdf8";
    ctx.fillStyle = selected ? "rgba(245, 158, 11, 0.08)" : "rgba(56, 189, 248, 0.04)";
    ctx.fillRect(slice.x, slice.y, slice.w, slice.h);
    ctx.strokeRect(slice.x + 0.5, slice.y + 0.5, slice.w - 1, slice.h - 1);
    if (selected) {
      const handle = Math.max(4, Math.round(canvas.width / 160));
      const points = [
        [slice.x, slice.y],
        [slice.x + slice.w / 2, slice.y],
        [slice.x + slice.w, slice.y],
        [slice.x, slice.y + slice.h / 2],
        [slice.x + slice.w, slice.y + slice.h / 2],
        [slice.x, slice.y + slice.h],
        [slice.x + slice.w / 2, slice.y + slice.h],
        [slice.x + slice.w, slice.y + slice.h],
      ];
      ctx.fillStyle = "#f59e0b";
      points.forEach(([x, y]) => {
        ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
      });
    }
  });
  ctx.restore();
  $("#atlasSliceLabel").textContent = `${sourceLabel} ${canvas.width}x${canvas.height} / ${state.atlasSlices.length} 片`;
  $("#downloadAtlasSlices").disabled = !state.atlasSlices.length;
  $("#downloadAtlasSliceManifest").disabled = !state.atlasSlices.length;
  renderAtlasSliceList();
}

function applyDetectedAtlasSlices(boxes, sourceLabel) {
  state.atlasSlices = boxesToSlices(boxes);
  state.selectedAtlasSliceIndex = state.atlasSlices[0]?.index ?? -1;
  renderAtlasSlices(sourceLabel);
}

function selectAtlasSlice(index) {
  if (!state.atlasSlices.some((slice) => slice.index === index)) return;
  state.selectedAtlasSliceIndex = index;
  renderAtlasSlices("手动选择");
}

function deleteSelectedAtlasSlice() {
  if (state.selectedAtlasSliceIndex < 0) return;
  state.atlasSlices = state.atlasSlices.filter((slice) => slice.index !== state.selectedAtlasSliceIndex);
  reindexAtlasSlices();
  renderAtlasSlices("删除后预览");
}

function renderAtlasSliceList() {
  const container = $("#atlasSliceList");
  container.innerHTML = "";
  if (!state.atlasSlices.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list-note";
    empty.textContent = "还没有切片。导入图集后点击自动识别或更新切割。";
    container.append(empty);
    return;
  }

  state.atlasSlices.forEach((slice) => {
    const row = document.createElement("article");
    row.className = "asset-row atlas-slice-row";
    row.classList.toggle("selected", slice.index === state.selectedAtlasSliceIndex);
    row.tabIndex = 0;
    row.dataset.index = String(slice.index);

    const preview = document.createElement("canvas");
    preview.width = Math.min(64, Math.max(1, slice.w));
    preview.height = Math.min(64, Math.max(1, slice.h));
    const previewContext = preview.getContext("2d");
    previewContext.imageSmoothingEnabled = false;
    previewContext.drawImage(sliceToCanvas(slice), 0, 0, preview.width, preview.height);

    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = slice.name;
    const detail = document.createElement("span");
    detail.textContent = `${slice.x},${slice.y} ${slice.w}x${slice.h}`;
    info.append(title, detail);

    row.addEventListener("click", () => selectAtlasSlice(slice.index));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectAtlasSlice(slice.index);
      }
    });
    row.append(preview, info);
    container.append(row);
  });
}

function getAtlasCanvasPoint(event) {
  const canvas = $("#atlasSliceCanvas");
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, ((event.clientX - rect.left) / rect.width) * canvas.width)),
    y: Math.max(0, Math.min(canvas.height, ((event.clientY - rect.top) / rect.height) * canvas.height)),
    scaleX: rect.width / canvas.width,
    scaleY: rect.height / canvas.height,
  };
}

function hitTestAtlasSlice(point) {
  const edge = Math.max(4, 8 / Math.max(point.scaleX, 0.001));
  for (let i = state.atlasSlices.length - 1; i >= 0; i -= 1) {
    const slice = state.atlasSlices[i];
    const left = Math.abs(point.x - slice.x) <= edge;
    const right = Math.abs(point.x - (slice.x + slice.w)) <= edge;
    const top = Math.abs(point.y - slice.y) <= edge;
    const bottom = Math.abs(point.y - (slice.y + slice.h)) <= edge;
    const insideX = point.x >= slice.x - edge && point.x <= slice.x + slice.w + edge;
    const insideY = point.y >= slice.y - edge && point.y <= slice.y + slice.h + edge;
    if (!insideX || !insideY) continue;

    if (left && top) return { index: slice.index, mode: "nw" };
    if (right && top) return { index: slice.index, mode: "ne" };
    if (left && bottom) return { index: slice.index, mode: "sw" };
    if (right && bottom) return { index: slice.index, mode: "se" };
    if (left) return { index: slice.index, mode: "w" };
    if (right) return { index: slice.index, mode: "e" };
    if (top) return { index: slice.index, mode: "n" };
    if (bottom) return { index: slice.index, mode: "s" };
    if (point.x >= slice.x && point.x <= slice.x + slice.w && point.y >= slice.y && point.y <= slice.y + slice.h) {
      return { index: slice.index, mode: "move" };
    }
  }
  return null;
}

function atlasCursorForMode(mode) {
  const cursors = {
    move: "move",
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    nw: "nwse-resize",
    se: "nwse-resize",
  };
  return cursors[mode] || "default";
}

function alphaAt(imageData, x, y) {
  const clampedX = Math.max(0, Math.min(imageData.width - 1, x));
  const clampedY = Math.max(0, Math.min(imageData.height - 1, y));
  return imageData.data[(clampedY * imageData.width + clampedX) * 4 + 3];
}

function atlasRangeHasAlpha(imageData, axis, line, start, end, threshold) {
  const min = Math.max(0, Math.floor(Math.min(start, end)));
  const max = Math.min((axis === "x" ? imageData.height : imageData.width) - 1, Math.ceil(Math.max(start, end)));
  const fixed = Math.round(line);
  for (let value = min; value <= max; value += 1) {
    const alpha = axis === "x" ? alphaAt(imageData, fixed, value) : alphaAt(imageData, value, fixed);
    if (alpha > threshold) return true;
  }
  return false;
}

function findAtlasAlphaBoundaries(axis, rangeStart, rangeEnd) {
  if (!state.atlasSliceImage) return [];
  const imageData = state.atlasDrag?.imageData || imageDataFromImage(state.atlasSliceImage);
  const threshold = Math.max(0, Number($("#atlasAutoThreshold").value) || 0);
  const limit = axis === "x" ? imageData.width : imageData.height;
  const boundaries = [];
  let previous = false;

  for (let position = 0; position <= limit; position += 1) {
    const current =
      position < limit ? atlasRangeHasAlpha(imageData, axis, position, rangeStart, rangeEnd, threshold) : false;
    if (position > 0 && current !== previous) boundaries.push(position);
    previous = current;
  }
  return boundaries;
}

function snapAtlasValue(value, axis, rangeStart, rangeEnd, threshold) {
  const boundaries = findAtlasAlphaBoundaries(axis, rangeStart, rangeEnd);
  let best = value;
  let bestDistance = threshold + 1;
  boundaries.forEach((boundary) => {
    const distance = Math.abs(boundary - value);
    if (distance < bestDistance) {
      best = boundary;
      bestDistance = distance;
    }
  });
  return bestDistance <= threshold ? best : value;
}

function normalizeAtlasSliceRect(slice) {
  const imageWidth = state.atlasSliceImage?.naturalWidth || state.atlasSliceImage?.width || 1;
  const imageHeight = state.atlasSliceImage?.naturalHeight || state.atlasSliceImage?.height || 1;
  const minSize = 1;
  slice.x = Math.max(0, Math.min(imageWidth - minSize, Math.round(slice.x)));
  slice.y = Math.max(0, Math.min(imageHeight - minSize, Math.round(slice.y)));
  slice.w = Math.max(minSize, Math.min(imageWidth - slice.x, Math.round(slice.w)));
  slice.h = Math.max(minSize, Math.min(imageHeight - slice.y, Math.round(slice.h)));
}

function updateAtlasSliceFromDrag(event) {
  if (!state.atlasDrag) return;
  const point = getAtlasCanvasPoint(event);
  const drag = state.atlasDrag;
  const slice = state.atlasSlices.find((item) => item.index === drag.index);
  if (!slice) return;
  const dx = point.x - drag.startPoint.x;
  const dy = point.y - drag.startPoint.y;
  const original = drag.original;
  const imageWidth = state.atlasSliceImage.naturalWidth || state.atlasSliceImage.width;
  const imageHeight = state.atlasSliceImage.naturalHeight || state.atlasSliceImage.height;
  const snapThreshold = Math.max(1, Math.round(10 / Math.max(point.scaleX, 0.001)));

  let left = original.x;
  let top = original.y;
  let right = original.x + original.w;
  let bottom = original.y + original.h;

  if (drag.mode === "move") {
    left = original.x + dx;
    top = original.y + dy;
    right = left + original.w;
    bottom = top + original.h;
    const snappedLeft = snapAtlasValue(left, "x", top, bottom, snapThreshold);
    const snappedRight = snapAtlasValue(right, "x", top, bottom, snapThreshold);
    const snappedTop = snapAtlasValue(top, "y", left, right, snapThreshold);
    const snappedBottom = snapAtlasValue(bottom, "y", left, right, snapThreshold);
    if (Math.abs(snappedLeft - left) <= Math.abs(snappedRight - right)) left = snappedLeft;
    else left = snappedRight - original.w;
    if (Math.abs(snappedTop - top) <= Math.abs(snappedBottom - bottom)) top = snappedTop;
    else top = snappedBottom - original.h;
    left = Math.max(0, Math.min(imageWidth - original.w, left));
    top = Math.max(0, Math.min(imageHeight - original.h, top));
    right = left + original.w;
    bottom = top + original.h;
  } else {
    if (drag.mode.includes("w")) left = original.x + dx;
    if (drag.mode.includes("e")) right = original.x + original.w + dx;
    if (drag.mode.includes("n")) top = original.y + dy;
    if (drag.mode.includes("s")) bottom = original.y + original.h + dy;
    if (drag.mode.includes("w")) left = snapAtlasValue(left, "x", top, bottom, snapThreshold);
    if (drag.mode.includes("e")) right = snapAtlasValue(right, "x", top, bottom, snapThreshold);
    if (drag.mode.includes("n")) top = snapAtlasValue(top, "y", left, right, snapThreshold);
    if (drag.mode.includes("s")) bottom = snapAtlasValue(bottom, "y", left, right, snapThreshold);
  }

  if (right < left) [left, right] = [right, left];
  if (bottom < top) [top, bottom] = [bottom, top];
  slice.x = left;
  slice.y = top;
  slice.w = right - left;
  slice.h = bottom - top;
  normalizeAtlasSliceRect(slice);
  renderAtlasSlices("手动调整");
}

function finishAtlasSliceDrag(event) {
  const canvas = $("#atlasSliceCanvas");
  if (event?.pointerId !== undefined && canvas.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  state.atlasDrag = null;
  const hit = event ? hitTestAtlasSlice(getAtlasCanvasPoint(event)) : null;
  canvas.style.cursor = atlasCursorForMode(hit?.mode);
  renderAtlasSlices("手动调整");
}

function applyAtlasSlice() {
  if (!state.atlasSliceImage) return;
  const settings = getSliceSettings();
  const canvas = $("#atlasSliceCanvas");
  fitCanvasToImage(canvas, state.atlasSliceImage);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.save();
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = Math.max(1, Math.round(canvas.width / 512));
  state.atlasSlices = [];

  for (let row = 0; row < settings.rows; row += 1) {
    for (let column = 0; column < settings.columns; column += 1) {
      const x = settings.marginX + column * (settings.cellWidth + settings.gapX);
      const y = settings.marginY + row * (settings.cellHeight + settings.gapY);
      if (x + settings.cellWidth > canvas.width || y + settings.cellHeight > canvas.height) continue;
      const index = state.atlasSlices.length;
      const slice = {
        index,
        name: `slice_${String(index + 1).padStart(4, "0")}.png`,
        x,
        y,
        w: settings.cellWidth,
        h: settings.cellHeight,
      };
      state.atlasSlices.push(slice);
      ctx.strokeRect(x + 0.5, y + 0.5, settings.cellWidth - 1, settings.cellHeight - 1);
    }
  }
  ctx.restore();
  $("#atlasSliceLabel").textContent = `图集预览 ${canvas.width}x${canvas.height} / ${state.atlasSlices.length} 片`;
  $("#downloadAtlasSlices").disabled = !state.atlasSlices.length;
  $("#downloadAtlasSliceManifest").disabled = !state.atlasSlices.length;
  renderAssetList($("#atlasSliceList"), state.atlasSlices, {
    detail: (item) => `${item.x},${item.y} ${item.w}x${item.h}`,
  });
}

function applyAtlasSlice() {
  if (!state.atlasSliceImage) return;
  const settings = getSliceSettings();
  const imageWidth = state.atlasSliceImage.naturalWidth || state.atlasSliceImage.width;
  const imageHeight = state.atlasSliceImage.naturalHeight || state.atlasSliceImage.height;
  const boxes = [];

  for (let row = 0; row < settings.rows; row += 1) {
    for (let column = 0; column < settings.columns; column += 1) {
      const x = settings.marginX + column * (settings.cellWidth + settings.gapX);
      const y = settings.marginY + row * (settings.cellHeight + settings.gapY);
      if (x + settings.cellWidth > imageWidth || y + settings.cellHeight > imageHeight) continue;
      boxes.push({
        x,
        y,
        w: settings.cellWidth,
        h: settings.cellHeight,
      });
    }
  }

  applyDetectedAtlasSlices(boxes, "手动网格");
}

function autoDetectAtlasSlices() {
  if (!state.atlasSliceImage) return;
  const mode = $("#atlasAutoMode").value;
  const threshold = Math.max(0, Number($("#atlasAutoThreshold").value) || 0);
  const minArea = Math.max(1, Number($("#atlasAutoMinArea").value) || 1);
  const padding = Math.max(0, Number($("#atlasAutoPadding").value) || 0);
  const imageData = imageDataFromImage(state.atlasSliceImage);
  const alphaMask = buildAtlasMask(imageData, "alpha", threshold);
  const solidMask = buildAtlasMask(imageData, "solid", threshold);
  const alphaBoxes = connectedBoxesFromMask(alphaMask.mask, alphaMask.width, alphaMask.height, minArea, padding);
  const solidBoxes = connectedBoxesFromMask(solidMask.mask, solidMask.width, solidMask.height, minArea, padding);
  const alphaRatio = alphaMask.transparentCount / alphaMask.mask.length;
  const sourceMask = alphaRatio > 0.01 ? alphaMask : solidMask;
  const grid = gridBoxesFromMask(sourceMask.mask, sourceMask.width, sourceMask.height, minArea, padding);
  let boxes = [];
  let label = "自动识别";

  if (mode === "alpha") {
    boxes = alphaBoxes;
    label = "透明背景识别";
  } else if (mode === "solid") {
    boxes = solidBoxes;
    label = "纯色背景识别";
  } else if (mode === "grid") {
    boxes = grid.boxes;
    label = "规则网格识别";
  } else if (alphaRatio > 0.01 && alphaBoxes.length) {
    boxes = alphaBoxes;
    label = "自动识别：透明背景";
  } else if (grid.boxes.length > 1) {
    boxes = grid.boxes;
    label = "自动识别：规则网格";
  } else {
    boxes = solidBoxes;
    label = "自动识别：纯色背景";
  }

  if (grid.boxes.length > 1 && (mode === "grid" || label.includes("规则网格"))) {
    $("#sliceColumns").value = grid.columnRuns.length || 1;
    $("#sliceRows").value = grid.rowRuns.length || 1;
    $("#sliceCellWidth").value = grid.columnRuns[0] ? grid.columnRuns[0][1] - grid.columnRuns[0][0] + 1 : 1;
    $("#sliceCellHeight").value = grid.rowRuns[0] ? grid.rowRuns[0][1] - grid.rowRuns[0][0] + 1 : 1;
    $("#sliceMarginX").value = grid.columnRuns[0]?.[0] || 0;
    $("#sliceMarginY").value = grid.rowRuns[0]?.[0] || 0;
    $("#sliceGapX").value = grid.columnRuns[1] ? grid.columnRuns[1][0] - grid.columnRuns[0][1] - 1 : 0;
    $("#sliceGapY").value = grid.rowRuns[1] ? grid.rowRuns[1][0] - grid.rowRuns[0][1] - 1 : 0;
  }

  applyDetectedAtlasSlices(boxes, label);
}

function sliceToCanvas(slice) {
  const source = document.createElement("canvas");
  fitCanvasToImage(source, state.atlasSliceImage);
  const canvas = document.createElement("canvas");
  canvas.width = slice.w;
  canvas.height = slice.h;
  canvas.getContext("2d").drawImage(source, slice.x, slice.y, slice.w, slice.h, 0, 0, slice.w, slice.h);
  return canvas;
}

function setupTabs() {
  const buttons = [...document.querySelectorAll(".tab-button")];
  const track = $(".wheel-track");
  const windowElement = $(".wheel-window");
  const toolDrawer = $("#toolDrawer");
  const toolDrawerList = $("#toolDrawerList");
  const normalizeIndex = (index) => ((index % buttons.length) + buttons.length) % buttons.length;
  let activeIndex = Math.max(0, buttons.findIndex((button) => button.classList.contains("active")));
  let visualIndex = activeIndex;
  let currentPanelId = buttons[activeIndex]?.dataset.panel || "chromaPanel";
  let showingOverview = true;
  let wheelDelta = 0;
  let dragLastY = 0;
  let dragOffset = 0;
  let slotStep = 88;
  let isDragging = false;
  let suppressClick = false;
  let settleTimer = 0;

  const getSignedDistance = (index) => {
    const total = buttons.length;
    let distance = index - visualIndex;
    const half = total / 2;
    if (distance > half) distance -= total;
    if (distance < -half) distance += total;
    return distance;
  };

  const layoutWheel = () => {
    slotStep = Math.max(80, Math.min(104, windowElement.clientHeight * 0.18));
    buttons.forEach((button, index) => {
      const distance = getSignedDistance(index);
      const position = distance * slotStep + dragOffset;
      const absoluteDistance = Math.abs(position / slotStep);
      const hidden = absoluteDistance > 2.35;
      const scale = Math.max(0.62, 1 - absoluteDistance * 0.13);
      const opacity = hidden ? 0 : Math.max(0.32, 1 - absoluteDistance * 0.25);
      button.style.setProperty("--slot-y", `${position}px`);
      button.style.setProperty("--slot-scale", scale.toFixed(3));
      button.style.setProperty("--slot-opacity", opacity.toFixed(3));
      button.style.setProperty("--slot-z", `${Math.round(200 - absoluteDistance * 10)}`);
      button.classList.toggle("preview", index === visualIndex && index !== activeIndex);
      button.tabIndex = index === activeIndex ? 0 : -1;
      button.setAttribute("aria-hidden", hidden ? "true" : "false");
    });
  };

  const pulseSelected = (button) => {
    button.classList.remove("just-selected");
    requestAnimationFrame(() => button.classList.add("just-selected"));
  };

  const renderOverview = (panelId) => {
    const meta = toolMeta[panelId];
    if (!meta) return;
    $("#overviewTitle").textContent = meta.name;
    $("#overviewDesc").textContent = meta.desc;
    $("#overviewUse").textContent = meta.use;
    $("#overviewUseDesc").textContent = meta.useDesc;
    $("#overviewInput").textContent = meta.input;
    $("#overviewInputDesc").textContent = meta.inputDesc;
    $("#overviewOutput").textContent = meta.output;
    $("#overviewOutputDesc").textContent = meta.outputDesc;
    $("#enterToolButton").textContent = `进入${meta.name}`;
  };

  const renderToolDrawerList = () => {
    toolDrawerList.innerHTML = "";
    toolGroups.forEach((group) => {
      const item = document.createElement("section");
      const activeInGroup = group.panels.includes(currentPanelId);
      item.className = "tool-drawer-item";
      item.classList.toggle("active", activeInGroup);
      item.innerHTML = `
        <span class="tool-drawer-item-copy">
          <strong>${group.name}</strong>
          <span>${group.desc}</span>
        </span>
        <small>${activeInGroup ? "当前组" : "工具组"}</small>
      `;
      const actions = document.createElement("div");
      actions.className = "tool-drawer-actions";
      group.panels.forEach((panelId) => {
        const index = buttons.findIndex((button) => button.dataset.panel === panelId);
        const meta = toolMeta[panelId];
        if (index < 0 || !meta) return;
        const action = document.createElement("button");
        action.type = "button";
        action.className = "tool-drawer-action";
        action.classList.toggle("active", index === activeIndex);
        action.textContent = meta.name;
        action.addEventListener("click", () => {
          closeToolDrawer();
          activateTool(index, true, true);
        });
        actions.append(action);
      });
      item.append(actions);
      toolDrawerList.append(item);
    });
  };

  function openToolDrawer() {
    renderToolDrawerList();
    toolDrawer.classList.add("is-open");
    toolDrawer.setAttribute("aria-hidden", "false");
    $("#toolDrawerClose").focus();
  }

  function closeToolDrawer() {
    toolDrawer.classList.remove("is-open");
    toolDrawer.setAttribute("aria-hidden", "true");
    $("#toolDrawerOpen").focus();
  }

  const showOverview = () => {
    showingOverview = true;
    $("#toolOverview").classList.add("active");
    document.querySelectorAll(".tool-panel").forEach((panel) => panel.classList.remove("active"));
    renderOverview(currentPanelId);
  };

  const enterTool = () => {
    showingOverview = false;
    $("#toolOverview").classList.remove("active");
    document.querySelectorAll(".tool-panel").forEach((panel) => panel.classList.remove("active"));
    $(`#${currentPanelId}`).classList.add("active");
  };

  const activateTool = (index, animate = true, enter = false) => {
    window.clearTimeout(settleTimer);
    activeIndex = normalizeIndex(index);
    visualIndex = activeIndex;
    dragOffset = 0;
    windowElement.classList.add("is-settling");
    windowElement.classList.remove("is-rolling");
    windowElement.classList.remove("is-dragging");
    const button = buttons[activeIndex];
    const panelId = button.dataset.panel;
    const meta = toolMeta[panelId];
    currentPanelId = panelId;

    document.querySelectorAll(".tab-button").forEach((item) => {
      item.classList.remove("active");
      item.classList.remove("just-selected");
    });
    button.classList.add("active");

    if (meta) {
      $("#currentToolName").textContent = meta.name;
      $("#currentToolDesc").textContent = meta.desc;
    }

    track.style.transform = "translateY(0)";
    layoutWheel();
    // Commit the snapped position before playing the in-place scale animation.
    void windowElement.offsetHeight;
    windowElement.classList.remove("is-settling");
    if (animate) {
      pulseSelected(button);
    }

    renderToolDrawerList();

    if (enter) {
      enterTool();
    } else {
      showOverview();
    }
  };

  const stageTool = (index) => {
    visualIndex = normalizeIndex(index);
    dragOffset = 0;
    windowElement.classList.add("is-rolling");
    layoutWheel();
  };

  const settleTool = (delay = 180) => {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      activateTool(visualIndex, true, !showingOverview);
    }, delay);
  };

  buttons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
    });
  });

  windowElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      wheelDelta += event.deltaY;
      const threshold = 36;
      if (Math.abs(wheelDelta) < threshold) return;
      const direction = wheelDelta > 0 ? 1 : -1;
      wheelDelta = 0;
      stageTool(visualIndex + direction);
      settleTool();
    },
    { passive: false },
  );

  windowElement.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const targetButton = event.target.closest(".tab-button");
    if (targetButton !== buttons[activeIndex]) return;
    window.clearTimeout(settleTimer);
    isDragging = true;
    dragLastY = event.clientY;
    dragOffset = 0;
    visualIndex = activeIndex;
    suppressClick = false;
    windowElement.classList.add("is-dragging");
    windowElement.setPointerCapture(event.pointerId);
  });

  windowElement.addEventListener("pointermove", (event) => {
    if (!isDragging) return;
    dragOffset += event.clientY - dragLastY;
    dragLastY = event.clientY;
    if (Math.abs(dragOffset) > 4) {
      suppressClick = true;
    }
    while (dragOffset > slotStep / 2) {
      visualIndex = normalizeIndex(visualIndex - 1);
      dragOffset -= slotStep;
    }
    while (dragOffset < -slotStep / 2) {
      visualIndex = normalizeIndex(visualIndex + 1);
      dragOffset += slotStep;
    }
    windowElement.classList.add("is-rolling");
    layoutWheel();
  });

  const stopDrag = (event) => {
    if (!isDragging) return;
    isDragging = false;
    if (windowElement.hasPointerCapture(event.pointerId)) {
      windowElement.releasePointerCapture(event.pointerId);
    }
    windowElement.classList.remove("is-dragging");
    if (suppressClick || visualIndex !== activeIndex) {
      activateTool(visualIndex, true, !showingOverview);
    } else {
      dragOffset = 0;
      layoutWheel();
    }
    window.setTimeout(() => {
      suppressClick = false;
    }, 0);
  };

  windowElement.addEventListener("pointerup", stopDrag);
  windowElement.addEventListener("pointercancel", stopDrag);
  $("#enterToolButton").addEventListener("click", enterTool);
  $("#toolDrawerOpen").addEventListener("click", openToolDrawer);
  $("#toolDrawerClose").addEventListener("click", closeToolDrawer);
  document.querySelector("[data-tool-drawer-close]").addEventListener("click", closeToolDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && toolDrawer.classList.contains("is-open")) {
      closeToolDrawer();
    }
  });
  document.querySelectorAll(".back-to-overview").forEach((button) => {
    button.addEventListener("click", showOverview);
  });
  window.addEventListener("resize", () => activateTool(activeIndex, false, !showingOverview));
  activateTool(activeIndex, false);
}

function setupTheme() {
  const savedTheme = localStorage.getItem("gameAssetForgeTheme") || "dark";
  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
    const nextLabel = theme === "light" ? "切换到暗色模式" : "切换到亮色模式";
    $("#themeToggle").setAttribute("aria-label", nextLabel);
    $("#themeToggle").title = nextLabel;
    localStorage.setItem("gameAssetForgeTheme", theme);
  };

  applyTheme(savedTheme);
  $("#themeToggle").addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(nextTheme);
  });
}

function setupRankingWindow() {
  const windowEl = $("#rankingWindow");
  const backdrop = $("#rankingBackdrop");
  const openButton = $("#rankingOpen");
  const closeButton = $("#rankingClose");
  const refreshButton = $("#rankingRefresh");
  const sourceSelect = $("#rankingSource");
  const countrySelect = $("#rankingCountry");
  const chartSelect = $("#rankingChart");
  const filterSelect = $("#rankingFilter");
  const limitSelect = $("#rankingLimit");
  const tableBody = $("#rankingTableBody");
  const meta = $("#rankingMeta");
  const subtitle = $("#rankingSubtitle");
  if (!windowEl || !openButton || !refreshButton || !tableBody) return;

  const closeRankingWindow = () => {
    windowEl.classList.add("hidden");
    backdrop?.classList.add("hidden");
  };

  const openRankingWindow = () => {
    backdrop?.classList.remove("hidden");
    windowEl.classList.remove("hidden");
  };

  const setMeta = (text) => {
    if (meta) meta.textContent = text;
  };

  const clearTable = (text) => {
    tableBody.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.textContent = text;
    row.appendChild(cell);
    tableBody.appendChild(row);
  };

  const renderRankings = (data) => {
    tableBody.replaceChildren();
    const items = data.items || [];
    if (!items.length) {
      clearTable("没有抓到榜单数据，可能是来源页面结构变化或网络被限制。");
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("tr");

      const rankCell = document.createElement("td");
      rankCell.textContent = item.rank ? `#${item.rank}` : "-";
      row.appendChild(rankCell);

      const changeCell = document.createElement("td");
      const change = item.rankChange || {};
      if (change.direction === "up") {
        changeCell.className = "rank-change rank-change-up";
        changeCell.textContent = `↑${change.value || 0}`;
      } else if (change.direction === "down") {
        changeCell.className = "rank-change rank-change-down";
        changeCell.textContent = `↓${change.value || 0}`;
      } else {
        changeCell.className = "rank-change";
        changeCell.textContent = "-";
      }
      row.appendChild(changeCell);

      const iconCell = document.createElement("td");
      if (item.icon) {
        const image = document.createElement("img");
        image.className = "ranking-icon";
        image.src = item.icon;
        image.alt = `${item.name || "app"} icon`;
        iconCell.appendChild(image);
      } else {
        iconCell.textContent = "-";
      }
      row.appendChild(iconCell);

      const nameCell = document.createElement("td");
      const nameWrap = document.createElement("div");
      nameWrap.className = "ranking-app-name";
      const link = document.createElement("a");
      link.textContent = item.name || "-";
      link.href = item.sourceUrl || "#";
      link.target = "_blank";
      link.rel = "noreferrer";
      nameWrap.appendChild(link);
      const developer = document.createElement("span");
      developer.textContent = item.developer || item.packageName || "-";
      nameWrap.appendChild(developer);
      nameCell.appendChild(nameWrap);
      row.appendChild(nameCell);

      const offlineCell = document.createElement("td");
      offlineCell.textContent = item.offlineCandidate ? "可能" : "-";
      if (item.offlineReason) offlineCell.title = item.offlineReason;
      row.appendChild(offlineCell);

      const ratingCell = document.createElement("td");
      ratingCell.textContent = item.rating ? item.rating.toFixed(1) : "-";
      row.appendChild(ratingCell);

      const downloadCell = document.createElement("td");
      downloadCell.textContent = item.recentDownloads ? `${item.downloads || "-"} / 近30日 ${item.recentDownloads}` : item.downloads || "-";
      row.appendChild(downloadCell);

      const releaseCell = document.createElement("td");
      releaseCell.textContent = formatChineseDate(item.releaseDate) || "未公开";
      row.appendChild(releaseCell);

      const sourceCell = document.createElement("td");
      sourceCell.textContent = item.source === "综合总榜" && item.sourceRanks?.length
        ? `综合 · ${item.sourceRanks.length}源`
        : `${item.source || data.source || "-"} · ${item.country || data.country || "-"}`;
      if (item.overallScore) sourceCell.title = `RRF 分数: ${item.overallScore.toFixed(5)}`;
      row.appendChild(sourceCell);

      tableBody.appendChild(row);
    });

    if (subtitle) subtitle.textContent = `${data.label || "排行榜"}，${data.cached ? "来自缓存" : "刚刚刷新"}。`;
    const releaseNote = data.fields?.releaseDate ? "" : "发布时间：当前公开来源未稳定提供，不使用更新时间代替。";
    const algorithmNote = data.algorithm ? ` | 算法: ${data.algorithm.name}` : "";
    setMeta(`来源: ${data.label || "-"} | 抓取时间: ${formatDateTime(data.fetchedAt)} | 条数: ${items.length}${algorithmNote}${releaseNote ? ` | ${releaseNote}` : ""}`);
  };

  const refreshRankings = async (force = true) => {
    const token = state.rankingFetchToken + 1;
    state.rankingFetchToken = token;
    refreshButton.disabled = true;
    clearTable("正在抓取公开榜单...");
    setMeta("正在连接榜单来源...");
    try {
      const source = sourceSelect?.value || "appbrain";
      const country = countrySelect?.value || "us";
      const chart = chartSelect?.value || "top_new_free";
      const filter = filterSelect?.value || "all";
      const limit = limitSelect?.value || "50";
      const data = await apiJson(
        `/api/rankings/apps?source=${encodeURIComponent(source)}&country=${encodeURIComponent(country)}&chart=${encodeURIComponent(chart)}&filter=${encodeURIComponent(filter)}&limit=${encodeURIComponent(limit)}&refresh=${force ? "1" : "0"}`,
      );
      if (token !== state.rankingFetchToken) return;
      renderRankings(data);
      setStatus(`排行榜已刷新：${data.items?.length || 0} 条`);
    } catch (error) {
      if (token !== state.rankingFetchToken) return;
      const message = String(error.message || "");
      clearTable(
        message.includes("/api/rankings/apps 404") || message.includes("Not found")
          ? "排行榜接口不可用：请重启 GameAssetForge 服务，或确认使用带 API 代理的最新 npm run serve。"
          : message,
      );
      setMeta("抓取失败。可以稍后重试，或切换另一个公开来源。");
    } finally {
      if (token === state.rankingFetchToken) refreshButton.disabled = false;
    }
  };

  openButton.addEventListener("click", () => {
    openRankingWindow();
    if (!tableBody.dataset.loaded) {
      tableBody.dataset.loaded = "true";
      refreshRankings(false);
    }
  });
  closeButton?.addEventListener("click", closeRankingWindow);
  backdrop?.addEventListener("click", closeRankingWindow);
  refreshButton.addEventListener("click", () => refreshRankings(true));
  sourceSelect?.addEventListener("change", () => refreshRankings(true));
  countrySelect?.addEventListener("change", () => refreshRankings(true));
  chartSelect?.addEventListener("change", () => refreshRankings(true));
  filterSelect?.addEventListener("change", () => refreshRankings(true));
  limitSelect?.addEventListener("change", () => refreshRankings(true));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !windowEl.classList.contains("hidden")) closeRankingWindow();
  });
}

function setupChromaTool() {
  updateChromaPreviewBackground();
  $("#chromaInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    state.chromaImage = await loadImageFromFile(file);
    applyChromaKey();
  });

  ["keyPreset", "customKeyColor", "keyTolerance", "softness", "spillStrength", "edgeCleanup", "mattingStrength", "mattingRadius"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      if (id === "customKeyColor") $("#keyPreset").value = "custom";
      $("#keyToleranceValue").textContent = $("#keyTolerance").value;
      $("#softnessValue").textContent = $("#softness").value;
      $("#spillStrengthValue").textContent = $("#spillStrength").value;
      $("#edgeCleanupValue").textContent = $("#edgeCleanup").value;
      $("#mattingStrengthValue").textContent = $("#mattingStrength").value;
      $("#mattingRadiusValue").textContent = $("#mattingRadius").value;
      applyChromaKey();
    });
  });
  $("#chromaPreviewBackground")?.addEventListener("input", updateChromaPreviewBackground);

  $("#eyedropperButton").addEventListener("click", () => {
    startEyedropper();
  });
  $("#chromaSourceCanvas").addEventListener("click", pickColorFromSourceCanvas);

  $("#downloadChroma").addEventListener("click", () => {
    downloadCanvas($("#chromaResultCanvas"), "chroma-key-result.png");
  });
}

function setupResizeTool() {
  $("#resizeInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    state.resizeImage = await loadImageFromFile(file);
    $("#resizeWidth").value = state.resizeImage.naturalWidth || state.resizeImage.width;
    $("#resizeHeight").value = state.resizeImage.naturalHeight || state.resizeImage.height;
    applyResize();
  });

  ["resizeMode", "resizeWidth", "resizeHeight", "resizeScale", "resizeMaxSide"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      updateResizeControls();
      applyResize();
    });
  });

  $("#downloadResize").addEventListener("click", () => {
    downloadCanvas($("#resizeResultCanvas"), "resized-image.png");
  });

  updateResizeControls();
}

function setupInterpolateTool() {
  $("#interpolateAInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    state.interpolateAImage = await loadImageFromFile(file);
    drawContainedImage($("#interpolateACanvas"), state.interpolateAImage);
    if (state.interpolateBImage) generateInterpolatedFrame();
    updateInterpolateButtons();
  });

  $("#interpolateBInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    state.interpolateBImage = await loadImageFromFile(file);
    drawContainedImage($("#interpolateBCanvas"), state.interpolateBImage);
    if (state.interpolateAImage) generateInterpolatedFrame();
    updateInterpolateButtons();
  });

  ["interpolateT", "interpolateMode"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      $("#interpolateTValue").textContent = Number($("#interpolateT").value).toFixed(2);
      if (state.interpolateAImage && state.interpolateBImage) generateInterpolatedFrame();
    });
  });

  $("#generateInterpolate").addEventListener("click", generateInterpolatedFrame);
  $("#downloadInterpolate").addEventListener("click", () => {
    downloadCanvas($("#interpolateResultCanvas"), "interpolated-frame.png");
  });

  updateInterpolateButtons();
}

function setupVideoTool() {
  $("#videoInput").addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (!file) return;
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = URL.createObjectURL(file);
    const video = $("#videoPreview");
    video.src = state.videoUrl;
    state.frames = [];
    state.selectedFrameId = null;
    renderFrames();
    setStatus("视频已载入");
  });

  $("#videoPreview").addEventListener("loadedmetadata", () => {
    $("#extractFrames").disabled = false;
    $("#captureCurrent").disabled = false;
    setStatus(`视频就绪 ${$("#videoPreview").videoWidth}x${$("#videoPreview").videoHeight}`);
  });

  $("#extractFrames").addEventListener("click", () => {
    extractFrames().catch((error) => setStatus(error.message));
  });

  [
    "videoKeyPreset",
    "videoKeyColor",
    "videoKeyTolerance",
    "videoSoftness",
    "videoSpillStrength",
    "videoEdgeCleanup",
    "videoMattingStrength",
    "videoMattingRadius",
  ].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      if (id === "videoKeyColor") $("#videoKeyPreset").value = "custom";
      $("#videoKeyToleranceValue").textContent = $("#videoKeyTolerance").value;
      $("#videoSoftnessValue").textContent = $("#videoSoftness").value;
      $("#videoSpillStrengthValue").textContent = $("#videoSpillStrength")?.value || "85";
      $("#videoEdgeCleanupValue").textContent = $("#videoEdgeCleanup")?.value || "18";
      $("#videoMattingStrengthValue").textContent = $("#videoMattingStrength")?.value || "70";
      $("#videoMattingRadiusValue").textContent = $("#videoMattingRadius")?.value || "4";
    });
  });

  $("#videoChromaEnabled").addEventListener("change", updateVideoChromaControls);

  $("#captureCurrent").addEventListener("click", captureCurrentFrame);
  $("#clearFrames").addEventListener("click", () => {
    state.frames = [];
    state.selectedFrameId = null;
    state.animationFrameIndex = 0;
    renderFrames();
    setStatus("帧已清空");
  });
  $("#toggleAnimation").addEventListener("click", () => {
    if (state.animationPlaying) {
      stopFrameAnimation();
    } else {
      startFrameAnimation();
    }
  });
  $("#resetAnimation").addEventListener("click", resetFrameAnimation);
  $("#animationFps").addEventListener("input", () => {
    if (state.animationPlaying) startFrameAnimation();
  });
  $("#downloadSelectedFrame").addEventListener("click", () => {
    downloadSelectedFrame().catch((error) => setStatus(error.message));
  });
  $("#downloadAtlas").addEventListener("click", () => {
    downloadAtlas().catch((error) => setStatus(error.message));
  });

  updateVideoChromaControls();
}

function setupBatchTool() {
  updateBatchOperationFields();
  $("#batchInput").addEventListener("change", async (event) => {
    state.batchItems = await Promise.all([...event.target.files].map(loadImageItem));
    renderBatchList();
  });
  $("#processBatch").addEventListener("click", () => {
    processBatchQueue().catch((error) => setStatus(error.message));
  });
  $("#downloadBatchAll").addEventListener("click", () => {
    state.batchItems.forEach((item) => {
      if (item.resultCanvas) downloadCanvasAs(item.resultCanvas, item.resultName);
    });
  });
  $("#clearBatch").addEventListener("click", () => {
    state.batchItems = [];
    renderBatchList();
  });
  [
    "batchOperation",
    "batchTrimAlpha",
    "batchTrimPadding",
    "batchScaleFactor",
    "batchChromaPreset",
    "batchChromaColor",
    "batchChromaTolerance",
    "batchChromaSoftness",
    "batchChromaSpill",
    "batchChromaEdgeCleanup",
    "batchTruePixelCellSize",
    "batchTruePixelOutputScale",
    "batchTruePixelColors",
    "batchTruePixelSharpen",
    "batchTruePixelKernel",
    "batchTruePixelDither",
  ].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      if (id === "batchOperation") updateBatchOperationFields();
      if (id === "batchChromaColor") $("#batchChromaPreset").value = "custom";
      if (state.batchItems.some((item) => item.resultCanvas)) processBatchQueue().catch((error) => setStatus(error.message));
    });
  });
  renderBatchList();
}

function setupTrimTool() {
  $("#trimInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    state.trimImage = await loadImageFromFile(file);
    applyTrim();
  });
  ["trimAlphaThreshold", "trimPadding"].forEach((id) => {
    $(`#${id}`).addEventListener("input", applyTrim);
  });
  $("#downloadTrim").addEventListener("click", () => {
    downloadCanvas($("#trimResultCanvas"), "trimmed.png");
  });
  $("#downloadTrimJson").addEventListener("click", () => {
    if (state.trimMetadata) downloadJson(state.trimMetadata, "trimmed-offset.json");
  });
}

function setupPixelScaleTool() {
  $("#pixelScaleInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    state.pixelScaleImage = await loadImageFromFile(file);
    applyPixelScale();
  });
  ["pixelScaleFactor", "pixelScaleGrid"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      document.querySelectorAll(".pixel-preview").forEach((item) => {
        item.classList.toggle("show-grid", $("#pixelScaleGrid").checked);
      });
      applyPixelScale();
    });
  });
  $("#downloadPixelScale").addEventListener("click", () => {
    downloadCanvas($("#pixelScaleResultCanvas"), "pixel-scaled.png");
  });
}

function setupTruePixelTool() {
  const handleTruePixelError = (error) => setText("truePixelStatus", error.message);
  const useTruePixelFile = async (file) => {
    if (!file) return;
    state.truePixelFile = file;
    state.truePixelImage = await loadImageFromFile(file);
    applyTruePixel();
  };
  $("#truePixelInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    useTruePixelFile(file).catch(handleTruePixelError);
  });
  bindFileDropzone($("#truePixelDropzone"), {
    acceptFile: isImageInputFile,
    onFile: useTruePixelFile,
    onInvalid: () => setText("truePixelStatus", "请拖入 PNG、JPG、WebP、GIF、AVIF 或 BMP 图片。"),
    onError: handleTruePixelError,
  });
  ["truePixelCellSize", "truePixelOutputScale", "truePixelColors", "truePixelSharpen", "truePixelKernel", "truePixelDither"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      applyTruePixel();
    });
  });
  $("#downloadTruePixel").addEventListener("click", () => {
    if (state.truePixelBlob) downloadBlob(state.truePixelBlob, "true-pixel.png");
  });
}

function setupPixelEditorTool() {
  createEditorCanvas(32, 32);
  $("#createPixelCanvas").addEventListener("click", () => {
    createEditorCanvas(Number($("#editorWidth").value), Number($("#editorHeight").value));
  });
  $("#editorImportInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    const image = await loadImageFromFile(file);
    $("#editorWidth").value = image.naturalWidth || image.width;
    $("#editorHeight").value = image.naturalHeight || image.height;
    createEditorCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const ctx = $("#pixelEditorCanvas").getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, $("#pixelEditorCanvas").width, $("#pixelEditorCanvas").height);
  });
  $("#clearPixelCanvas").addEventListener("click", () => {
    const canvas = $("#pixelEditorCanvas");
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  });
  $("#downloadPixelEditor").addEventListener("click", () => {
    downloadCanvas($("#pixelEditorCanvas"), "pixel-edit.png");
  });
  $(".editor-stage").addEventListener("wheel", handleEditorWheel, { passive: false });
  $(".editor-stage").addEventListener("scroll", () => updateEditorBrushPreview());
  $("#editorBrushSize").addEventListener("input", () => updateEditorBrushPreview());
  $("#editorTool").addEventListener("change", () => updateEditorBrushPreview());
  $("#pixelEditorCanvas").addEventListener("pointerenter", updateEditorBrushPreview);
  $("#pixelEditorCanvas").addEventListener("pointerdown", (event) => {
    state.editorDrawing = true;
    $("#pixelEditorCanvas").setPointerCapture(event.pointerId);
    paintEditorPixel(event);
    updateEditorBrushPreview(event);
  });
  $("#pixelEditorCanvas").addEventListener("pointermove", (event) => {
    updateEditorBrushPreview(event);
    if (state.editorDrawing) paintEditorPixel(event);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
    $("#pixelEditorCanvas").addEventListener(type, () => {
      state.editorDrawing = false;
      if (type !== "pointerup") hideEditorBrushPreview();
    });
  });
}

function setupSequenceTool() {
  $("#sequenceInput").addEventListener("change", async (event) => {
    state.sequenceItems = await Promise.all(
      [...event.target.files].map(async (file, index) => ({
        file,
        name: file.name,
        newName: file.name,
        dataUrl: await fileToDataUrl(file),
        id: crypto.randomUUID(),
        index,
      })),
    );
    applySequenceRename();
  });
  ["sequenceSort", "sequencePrefix", "sequenceStart", "sequencePadding"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      if (state.sequenceItems.length) applySequenceRename();
    });
  });
  $("#applySequenceRename").addEventListener("click", applySequenceRename);
  $("#downloadSequenceAll").addEventListener("click", () => {
    state.sequenceItems.forEach((item) => downloadBlob(item.file, item.newName));
  });
  $("#downloadSequenceManifest").addEventListener("click", () => {
    downloadJson(getSequenceManifest(), "sequence-manifest.json");
  });
  renderSequenceList();
}

function setupAtlasSliceTool() {
  $("#atlasSliceInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    state.atlasSliceImage = await loadImageFromFile(file);
    $("#sliceCellWidth").value = Math.max(1, Math.floor((state.atlasSliceImage.naturalWidth || state.atlasSliceImage.width) / Number($("#sliceColumns").value)));
    $("#sliceCellHeight").value = Math.max(1, Math.floor((state.atlasSliceImage.naturalHeight || state.atlasSliceImage.height) / Number($("#sliceRows").value)));
    $("#applyAtlasSlice").disabled = false;
    $("#autoDetectSlice").disabled = false;
    applyAtlasSlice();
  });
  $("#autoDetectSlice").addEventListener("click", () => {
    autoDetectAtlasSlices();
  });
  [
    "sliceNamePrefix",
    "sliceColumns",
    "sliceRows",
    "sliceCellWidth",
    "sliceCellHeight",
    "sliceMarginX",
    "sliceMarginY",
    "sliceGapX",
    "sliceGapY",
  ].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      if (id === "sliceNamePrefix" && state.atlasSlices.length) {
        renameAtlasSlices();
        return;
      }
      applyAtlasSlice();
    });
  });
  $("#applyAtlasSlice").addEventListener("click", applyAtlasSlice);
  $("#downloadAtlasSlices").addEventListener("click", () => {
    state.atlasSlices.forEach((slice) => downloadCanvasAs(sliceToCanvas(slice), slice.name));
  });
  $("#downloadAtlasSliceManifest").addEventListener("click", () => {
    downloadJson({ image: "atlas.png", frames: state.atlasSlices }, "atlas-slices.json");
  });
  $("#atlasSliceCanvas").addEventListener("pointermove", (event) => {
    if (state.atlasDrag) {
      updateAtlasSliceFromDrag(event);
      return;
    }
    const hit = hitTestAtlasSlice(getAtlasCanvasPoint(event));
    state.atlasHover = hit;
    $("#atlasSliceCanvas").style.cursor = atlasCursorForMode(hit?.mode);
  });
  $("#atlasSliceCanvas").addEventListener("pointerdown", (event) => {
    const hit = hitTestAtlasSlice(getAtlasCanvasPoint(event));
    if (!hit) return;
    const slice = state.atlasSlices.find((item) => item.index === hit.index);
    if (!slice) return;
    event.preventDefault();
    $("#atlasSliceCanvas").focus();
    state.selectedAtlasSliceIndex = hit.index;
    state.atlasDrag = {
      index: hit.index,
      mode: hit.mode,
      startPoint: getAtlasCanvasPoint(event),
      original: { ...slice },
      imageData: imageDataFromImage(state.atlasSliceImage),
    };
    $("#atlasSliceCanvas").setPointerCapture(event.pointerId);
    $("#atlasSliceCanvas").style.cursor = atlasCursorForMode(hit.mode);
    renderAtlasSlices("手动调整");
  });
  $("#atlasSliceCanvas").addEventListener("pointerup", finishAtlasSliceDrag);
  $("#atlasSliceCanvas").addEventListener("pointercancel", (event) => {
    finishAtlasSliceDrag(event);
    $("#atlasSliceCanvas").style.cursor = "default";
  });
  $("#atlasSliceCanvas").addEventListener("pointerleave", () => {
    if (!state.atlasDrag) $("#atlasSliceCanvas").style.cursor = "default";
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const editingText = target?.matches?.("input, textarea, select, [contenteditable='true']");
    const atlasPanelActive = $("#atlasSlicePanel").classList.contains("active");
    if (!atlasPanelActive || editingText) return;
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    event.preventDefault();
    deleteSelectedAtlasSlice();
  });
}

function setupExtendedTools() {
  const bindFileState = (inputId, buttonIds, statusId, label) => {
    const input = $(`#${inputId}`);
    if (!input) return;
    input.addEventListener("change", () => {
      const hasFiles = selectedFiles(inputId).length > 0;
      buttonIds.forEach((id) => {
        const button = $(`#${id}`);
        if (button) button.disabled = !hasFiles;
      });
      setText(statusId, hasFiles ? `${label}: ${selectedFiles(inputId).length}` : "等待选择素材...");
    });
  };

  bindFileState("convertInput", ["runConvert"], "convertStatus", "已选择图片");
  bindFileState("atlasPackInput", ["runAtlasPack"], "atlasPackStatus", "已选择帧图");
  bindFileState("unityApkInput", ["runUnityApkExtract"], "unityApkStatus", "已选择 APK");
  bindFileState("spriteFxInput", ["runSpriteFx"], "spriteFxStatus", "已选择 Sprite");
  bindFileState("animationInput", ["runAnimationExport"], "pipelineReport", "已选择序列帧");
  bindFileState("gridToolInput", ["runNineSlice", "runTileset"], "pipelineReport", "已选择网格图片");
  bindFileState("qualityInput", ["runQualityReport", "runBatchColor"], "pipelineReport", "已选择质检素材");
  bindFileState("audioInput", ["runAudio"], "audioStatus", "已选择音频");

  const renderUnityToolchain = (status) => {
    const stateLabel = (tool) => (tool.automationAvailable ? "OK" : tool.available ? "仅手动/专家模式" : "缺失");
    const lines = [`内置工具目录: ${status.externalRoot}`];
    lines.push("", "资源/代码适配器:");
    status.tools.forEach((tool) => {
      lines.push(
        `${stateLabel(tool)} ${tool.label} (${tool.kind})`,
        `  用途: ${tool.purpose}`,
        `  目录: ${tool.directory}`,
        `  程序: ${tool.executable || tool.candidates.join(" / ")}`,
      );
      if (tool.manualReason) lines.push(`  说明: ${tool.manualReason}`);
      if (tool.script && !tool.scriptAvailable) lines.push(`  脚本缺失: ${tool.script}`);
    });
    if (status.restorePipeline) {
      lines.push("", "完整复原内置链路:");
      Object.entries(status.restorePipeline).forEach(([name, tool]) => {
        lines.push(
          `${stateLabel(tool)} ${tool.label || name} (${name})`,
          `  用途: ${tool.purpose || "-"}`,
          `  路径: ${tool.path}`,
        );
        if (tool.cliPath) lines.push(`  CLI: ${tool.cliPath}`);
        if (tool.guiPath) lines.push(`  GUI: ${tool.guiPath}`);
        if (tool.warning) lines.push(`  注意: ${tool.warning}`);
      });
    }
    setText("unityApkStatus", lines.join("\n"));
  };

  const detectUnityTools = () => {
    setText("unityApkStatus", "检测内置工具链...");
    apiJson("/api/unity/toolchain")
      .then(renderUnityToolchain)
      .catch((error) => setText("unityApkStatus", error.message));
  };

  const updateUnityExpertFields = () => {
    const expert = $("#unityRunMode")?.value === "expert";
    document.querySelectorAll(".unity-expert-field").forEach((field) => field.classList.toggle("hidden", !expert));
  };

  const currentUnityToolLabel = () => {
    const mode = $("#unityApkMode")?.value;
    return {
      resources: "AssetStudio（资源转换导出）",
      assets: "AssetStudio（资源转换导出）",
      full: "AssetStudio + jadx + Cpp2IL（可用时）",
    }[mode] || "AssetStudio（资源转换导出）";
  };

  const renderUnityModeGuide = () => {
    const mode = $("#unityApkMode")?.value || "resources";
    const toolLabel = currentUnityToolLabel();
    const lines = [
      "当前模式说明",
      "",
      `处理模式: ${mode === "full" ? "导出全部 + Unity 可打开结构" : "只导出资源"}`,
      `内部工具链: ${toolLabel}`,
      "",
      "生成后的 ZIP 里会有什么:",
    ];

    if (mode === "full") {
      lines.push(
        "- UnityRestoredProject/: Unity 2022+ 可以打开的检查工程骨架。",
        "- UnityRestoredProject/Assets/Extracted/: AssetStudio 转出的贴图、音频、模型、文本等资源。",
        "- UnityRestoredProject/Assets/CodeRecovery/: metadata、Managed DLL 或 Cpp2IL 结果（条件满足时）。",
        "- Decompiled/AndroidJava/: jadx 反编译出的 Android Java/Dex 层代码。",
        "- REVERSING_REPORT.md 和 ReverseSummary.json: 本次复原质量、缺失项和工具日志摘要。",
        "",
        "需要注意:",
        "- 这不是原始开发工程，只是便于 Unity 打开检查的复原结构。",
        "- IL2CPP 游戏不能直接还原原始 C# 源码；有 libil2cpp.so + global-metadata.dat 时，才会尝试 Cpp2IL 类型恢复。",
        "- 如果 APK 是 App Bundle 的 base.apk，native 代码常在 config.arm64_v8a.apk 这种 split 包里。",
      );
    } else {
      lines.push(
        "- tool-output/: AssetStudio 转出的 Texture2D/Sprite、AudioClip、TextAsset、Mesh 等。",
        "- manifest.json: APK 结构、工具链状态和资源导出统计。",
        "- 这个模式不输出 Java/IL2CPP 代码，也不创建 Unity 工程骨架。",
        "- 正常情况下不会把原始 bundle/Data 一起打包进去，所以你看到的应是转换后的资源文件。",
      );
    }

    if (state.unityApkInspection) {
      const analysis = state.unityApkInspection.analysis || {};
      lines.push(
        "",
        "当前 APK 验证:",
        `- ${state.unityApkInspection.isUnityLike ? "已检测为 Unity APK" : "未检测到 Unity APK 结构"}`,
        `- Unity 相关文件: ${state.unityApkInspection.unityFileCount || 0}`,
        `- AssetBundle: ${(analysis.assetBundles || []).length}`,
        `- global-metadata.dat: ${(analysis.metadataFiles || []).length}`,
        `- libil2cpp.so: ${(analysis.il2cppLibraries || []).length}`,
      );
    }

    setText("unityApkStatus", lines.join("\n"));
  };

  const updateUnityModeGuidance = () => {
    const includeRaw = $("#unityIncludeRaw");
    if (includeRaw) {
      includeRaw.checked = false;
    }
    renderUnityModeGuide();
  };

  const isUnityApkInputFile = (file) => /\.(apk|zip)$/i.test(file?.name || "");

  const setUnityApkInputFile = (file) => {
    const input = $("#unityApkInput");
    if (!input || !file) return false;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };

  const setupUnityApkDropzone = () => {
    const dropzone = $("#unityApkDropzone");
    if (!dropzone) return;
    const leave = () => dropzone.classList.remove("is-drag-over");
    ["dragenter", "dragover"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropzone.classList.add("is-drag-over");
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      });
    });
    ["dragleave", "dragend"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        leave();
      });
    });
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      leave();
      const file = [...(event.dataTransfer?.files || [])].find(isUnityApkInputFile);
      if (!file) {
        setText("unityApkStatus", "请拖入 .apk 或 .zip 文件。");
        return;
      }
      setUnityApkInputFile(file);
    });
  };

  const closeUnityInspectDialog = () => {
    $("#unityInspectDialog")?.classList.add("hidden");
  };

  const showUnityInspectDialog = (inspection) => {
    const dialog = $("#unityInspectDialog");
    const title = $("#unityInspectTitle");
    const subtitle = $("#unityInspectSubtitle");
    const report = $("#unityInspectReport");
    const confirm = $("#unityInspectConfirm");
    if (!dialog || !inspection) return;

    const analysis = inspection.analysis || {};
    if (title) title.textContent = inspection.title || (inspection.isUnityLike ? "Unity APK 验证通过" : "Unity APK 验证未通过");
    if (subtitle) subtitle.textContent = inspection.subtitle || inspection.source || "APK 结构检查";
    if (confirm) {
      confirm.disabled = !inspection.canExtract;
      confirm.textContent = inspection.canExtract ? "继续提取" : "不可继续";
    }

    const lines = [
      `文件: ${inspection.source || "-"}`,
      `大小: ${Math.round((inspection.size || 0) / 1024 / 1024 * 100) / 100} MB`,
      `结果: ${inspection.isUnityLike ? "检测为 Unity APK" : "未检测到 Unity APK 结构"}`,
      `脚本后端: ${analysis.scriptingBackend || "Unknown"}`,
      "",
      "结构统计:",
      `  总文件: ${analysis.fileCount || 0}`,
      `  Unity 相关文件: ${inspection.unityFileCount || 0}`,
      `  assets/bin/Data: ${analysis.unityDataFiles || 0}`,
      `  StreamingAssets: ${analysis.streamingAssets || 0}`,
      `  AssetBundle: ${(analysis.assetBundles || []).length}`,
      `  .assets 文件: ${(analysis.assetFiles || []).length}`,
      `  resource/ress/resS: ${(analysis.resourceFiles || []).length}`,
      `  场景文件: ${(analysis.sceneFiles || []).length}`,
      `  Managed DLL: ${(analysis.managedDlls || []).length}`,
      `  libunity.so: ${(analysis.unityLibraries || []).length}`,
      `  libil2cpp.so: ${(analysis.il2cppLibraries || []).length}`,
      `  global-metadata.dat: ${(analysis.metadataFiles || []).length}`,
      "",
      `下一步: ${inspection.nextAction || "-"}`,
    ];
    if ((inspection.warnings || []).length) {
      lines.push("", "警告:");
      inspection.warnings.forEach((warning) => lines.push(`  - ${warning}`));
    }
    if ((inspection.notes || []).length) {
      lines.push("", "备注:");
      inspection.notes.forEach((note) => lines.push(`  - ${note}`));
    }
    if (report) report.textContent = lines.join("\n");
    dialog.classList.remove("hidden");
  };

  const inspectSelectedUnityApk = async () => {
    const [file] = selectedFiles("unityApkInput");
    const button = $("#runUnityApkExtract");
    const token = state.unityApkInspectToken + 1;
    state.unityApkInspectToken = token;
    state.unityApkInspection = null;
    if (button) button.disabled = true;
    if (!file) {
      closeUnityInspectDialog();
      return;
    }

    setText("unityApkStatus", "正在验证 APK 是否为 Unity 项目...");
    const form = new FormData();
    form.append("apk", file, file.name);
    try {
      const inspection = await apiJson("/api/unity/apk-inspect", form);
      if (token !== state.unityApkInspectToken) return;
      state.unityApkInspection = inspection;
      if (button) button.disabled = !inspection.canExtract;
      renderUnityModeGuide();
      showUnityInspectDialog(inspection);
    } catch (error) {
      if (token !== state.unityApkInspectToken) return;
      const rawMessage = error.message || "";
      const friendlyMessage =
        rawMessage.includes("/api/unity/apk-inspect 404") || rawMessage.includes("Not found")
          ? "Unity APK 验证接口不可用：当前页面连接的服务不是最新后端，或没有运行在 GameAssetForge API 服务上。请刷新页面并确认使用 http://127.0.0.1:5180 打开。"
          : rawMessage;
      const inspection = {
        source: file.name,
        size: file.size,
        isUnityLike: false,
        canExtract: false,
        analysis: {},
        warnings: [friendlyMessage],
        notes: [],
        nextAction: "APK 结构解析失败，请确认文件是否为有效 APK/ZIP。",
      };
      state.unityApkInspection = inspection;
      if (button) button.disabled = true;
      setText("unityApkStatus", inspection.nextAction);
      showUnityInspectDialog(inspection);
    }
  };

  const setUnityProgress = (job) => {
    const panel = $("#unityApkProgress");
    const fill = $("#unityApkProgressFill");
    const percentText = $("#unityApkProgressPercent");
    const label = $("#unityApkProgressLabel");
    const percent = Math.max(0, Math.min(100, Math.round(job?.percent || 0)));
    panel?.classList.remove("hidden");
    if (fill) fill.style.width = `${percent}%`;
    if (percentText) percentText.textContent = `${percent}%`;
    if (label) label.textContent = job?.message || job?.phase || "处理中...";
  };

  const renderUnityJob = (job) => {
    setUnityProgress(job);
    const lines = [
      `任务: ${job.id}`,
      `状态: ${job.status} / ${job.phase || "-"}`,
      `进度: ${Math.round(job.percent || 0)}%`,
      `当前: ${job.message || "-"}`,
    ];
    if (job.error) lines.push(`错误: ${job.error}`);
    if (job.resultSummary) {
      const summary = job.resultSummary;
      lines.push(
        "",
        "ZIP 实际内容:",
        `  总文件: ${summary.totalEntries || 0}`,
        `  资源导出: ${summary.toolOutputEntries || 0}`,
        `  Unity 工程: ${summary.unityProjectEntries || 0}`,
        `  AssetRipper 工程: ${summary.assetRipperEntries || 0}`,
        `  Java 代码: ${summary.javaEntries || 0}`,
        `  原始结构: ${summary.rawEntries || 0}`,
        `  模式/工具: ${summary.modeLabel || summary.mode || "-"} / ${summary.tool || "-"}`,
      );
      if (summary.restoreSummary?.counts) {
        const counts = summary.restoreSummary.counts;
        const recovery = summary.restoreSummary.recovery || {};
        const quality = summary.restoreSummary.quality;
        lines.push(
          "",
          "完整复原摘要:",
          `  转出资源: ${counts.extractedAssets || 0}`,
          `  Java 文件: ${counts.javaFiles || 0}`,
          `  Unity 工程文件: ${counts.projectFiles || 0}`,
          `  metadata: ${recovery.metadataCopied ? "已复制" : "未复制"}`,
          `  libil2cpp.so: ${recovery.libil2cppFound ? "已检测到" : "未检测到"}`,
        );
        if (quality) {
          lines.push(
            "",
            "恢复质量:",
            `  等级: ${quality.label || quality.tier || "-"}`,
            `  分数: ${quality.score ?? "-"} / 100`,
            `  结论: ${quality.summary || "-"}`,
          );
          if ((quality.missing || []).length) {
            lines.push("  缺失/受限:");
            quality.missing.slice(0, 6).forEach((item) => lines.push(`    - ${item}`));
          }
        }
      }
      if (summary.resourceExport) {
        lines.push(
          "",
          "资源导出摘要:",
          `  AssetStudio 状态: ${summary.resourceExport.status || "-"}`,
          `  输出文件: ${summary.resourceExport.outputFileCount || 0}`,
        );
      }
      if (summary.externalTool?.status === "skipped" || summary.externalTool?.ran === false) {
        lines.push(`  工具状态: ${summary.externalTool.status || "未运行"}`);
        if (summary.externalTool.reason) lines.push(`  原因: ${summary.externalTool.reason}`);
      }
      if (summary.setupOnly) {
        lines.push(
          "",
          "这次 ZIP 只有说明文件，没有实际资源/工程输出。",
          "要提取资源：请选择“只提取游戏资源”。",
          "要还原工程：需要专家模式配置可自动退出的 AssetRipper CLI。",
        );
      }
      if ((summary.warnings || []).length) {
        lines.push("", "输出警告:");
        summary.warnings.forEach((warning) => lines.push(`  - ${warning}`));
      }
    }
    if (job.detail?.fileCount) {
      lines.push(
        "",
        "APK 识别:",
        `  总文件: ${job.detail.fileCount}`,
        `  Unity 相关: ${job.detail.unityFileCount || 0}`,
        `  Data 文件: ${job.detail.unityDataFiles || 0}`,
        `  AssetBundle: ${job.detail.assetBundles || 0}`,
        `  Metadata: ${job.detail.metadataFiles || 0}`,
      );
    }
    const log = (job.log || []).slice(-12);
    if (log.length) {
      lines.push("", "最近进度:");
      log.forEach((entry) => {
        lines.push(`  [${Math.round(entry.percent || 0)}%] ${entry.message}`);
      });
    }
    setText("unityApkStatus", lines.join("\n"));
  };

  const runUnityApkJob = async (form) => {
    const button = $("#runUnityApkExtract");
    if (button) button.disabled = true;
    try {
      const job = await apiJson("/api/unity/apk-extract/jobs", form);
      renderUnityJob(job);
      let current = job;
      while (!["done", "failed"].includes(current.status)) {
        await sleep(900);
        current = await apiJson(`/api/unity/apk-extract/jobs/${job.id}`);
        renderUnityJob(current);
      }
      if (current.status === "failed") {
        throw new Error(current.error || current.message || "Unity APK 任务失败");
      }
      if (current.resultSummary?.setupOnly) {
        setStatus("Unity APK 任务完成，但没有实际资源/工程输出。");
        return;
      }
      const filename = await downloadResponseBlob(current.downloadUrl, current.filename || `unity-apk-${file.name.replace(/\.[^.]+$/, "") || "apk"}.zip`);
      setText("unityApkStatus", `${$("#unityApkStatus")?.textContent || ""}\n\n已导出: ${filename}`);
      setStatus(`已导出 ${filename}`);
    } finally {
      if (button) button.disabled = selectedFiles("unityApkInput").length === 0;
    }
  };

  $("#detectUnityTools")?.addEventListener("click", detectUnityTools);
  $("#unityRunMode")?.addEventListener("change", () => {
    updateUnityExpertFields();
    updateUnityModeGuidance();
  });
  $("#unityApkMode")?.addEventListener("change", updateUnityModeGuidance);
  $("#unityApkTool")?.addEventListener("change", updateUnityModeGuidance);
  $("#unityIncludeRaw")?.addEventListener("change", updateUnityModeGuidance);
  $("#unityToolCommand")?.addEventListener("input", updateUnityModeGuidance);
  $("#unityToolArgs")?.addEventListener("input", updateUnityModeGuidance);
  $("#unityApkInput")?.addEventListener("change", inspectSelectedUnityApk);
  setupUnityApkDropzone();
  document.querySelectorAll("[data-close-unity-inspect]").forEach((element) => {
    element.addEventListener("click", closeUnityInspectDialog);
  });
  $("#unityInspectConfirm")?.addEventListener("click", closeUnityInspectDialog);
  updateUnityExpertFields();
  updateUnityModeGuidance();

  $("#runConvert")?.addEventListener("click", () => {
    const [file] = selectedFiles("convertInput");
    const form = new FormData();
    form.append("image", file, file.name);
    form.append("format", $("#convertFormat").value);
    form.append("quality", $("#convertQuality").value);
    form.append("maxSide", $("#convertMaxSide").value);
    form.append("background", $("#convertBackground").value);
    apiDownload("/api/image/convert", form, `converted.${$("#convertFormat").value}`, "convertStatus").catch((error) =>
      setText("convertStatus", error.message),
    );
  });

  $("#runAtlasPack")?.addEventListener("click", () => {
    const form = new FormData();
    appendFiles(form, "frames", selectedFiles("atlasPackInput"));
    form.append("padding", $("#atlasPackPadding").value);
    form.append("extrude", $("#atlasPackExtrude").value);
    form.append("maxSize", $("#atlasPackMaxSize").value);
    form.append("engine", $("#atlasPackEngine").value);
    form.append("trim", $("#atlasPackTrim").checked ? "true" : "false");
    form.append("powerOfTwo", $("#atlasPackPOT").checked ? "true" : "false");
    apiDownload("/api/atlas/pack", form, "packed-atlas.zip", "atlasPackStatus").catch((error) =>
      setText("atlasPackStatus", error.message),
    );
  });

  $("#runUnityApkExtract")?.addEventListener("click", () => {
    const [file] = selectedFiles("unityApkInput");
    if (!state.unityApkInspection?.canExtract) {
      showUnityInspectDialog(
        state.unityApkInspection || {
          source: file?.name || "未选择 APK",
          size: file?.size || 0,
          isUnityLike: false,
          canExtract: false,
          analysis: {},
          warnings: ["请先选择 APK 并等待 Unity 项目验证通过。"],
          notes: [],
          nextAction: "验证通过后才能执行提取工具链。",
        },
      );
      return;
    }
    const form = new FormData();
    const selectedMode = $("#unityApkMode")?.value === "full" ? "full" : "resources";
    form.append("apk", file, file.name);
    form.append("mode", selectedMode);
    form.append("runMode", "quick");
    form.append("tool", selectedMode === "full" ? "restore-pipeline" : "assetstudio");
    form.append("assetTypes", "texture,audio,mesh,text");
    form.append("includeRaw", "false");
    const commandTemplate = $("#unityToolCommand").value.trim();
    const toolArgs = $("#unityToolArgs").value.trim();
    if (commandTemplate) form.append("commandTemplate", commandTemplate);
    if (toolArgs) form.append("toolArgs", toolArgs);
    runUnityApkJob(form).catch((error) =>
      setText("unityApkStatus", error.message),
    );
  });

  $("#runSpriteFx")?.addEventListener("click", () => {
    const [file] = selectedFiles("spriteFxInput");
    const operation = $("#spriteFxOperation").value;
    const form = new FormData();
    form.append("image", file, file.name);
    form.append("color", $("#spriteFxColor").value);
    form.append("thickness", $("#spriteFxStrength").value);
    form.append("strength", $("#spriteFxStrength").value);
    form.append("iterations", $("#spriteFxStrength").value);
    form.append("colors", $("#spriteFxColors").value);
    form.append("brightness", $("#spriteFxBrightness").value);
    form.append("saturation", $("#spriteFxSaturation").value);
    form.append("hue", $("#spriteFxHue").value);

    const endpoint =
      operation === "edge"
        ? "/api/image/edge-fix"
        : operation === "normal"
          ? "/api/image/normal-map"
          : operation === "mask"
            ? "/api/image/mask-map"
            : "/api/image/stylize";
    if (!["edge", "normal", "mask"].includes(operation)) form.append("operation", operation);
    apiDownload(endpoint, form, `${operation}.png`, "spriteFxStatus").catch((error) =>
      setText("spriteFxStatus", error.message),
    );
  });

  $("#runAnimationExport")?.addEventListener("click", () => {
    const form = new FormData();
    appendFiles(form, "frames", selectedFiles("animationInput"));
    form.append("fps", $("#animationFpsExport").value);
    form.append("format", $("#animationFormat").value);
    apiDownload("/api/sequence/animation", form, `animation.${$("#animationFormat").value}`, "pipelineReport").catch((error) =>
      setText("pipelineReport", error.message),
    );
  });

  $("#runNineSlice")?.addEventListener("click", () => {
    const [file] = selectedFiles("gridToolInput");
    const form = new FormData();
    form.append("image", file, file.name);
    form.append("left", $("#gridA").value);
    form.append("right", $("#gridB").value);
    form.append("top", $("#gridC").value);
    form.append("bottom", $("#gridD").value);
    apiDownload("/api/ui/nine-slice", form, "nine-slice.zip", "pipelineReport").catch((error) =>
      setText("pipelineReport", error.message),
    );
  });

  $("#runTileset")?.addEventListener("click", () => {
    const [file] = selectedFiles("gridToolInput");
    const form = new FormData();
    form.append("image", file, file.name);
    form.append("tileWidth", $("#gridA").value);
    form.append("tileHeight", $("#gridB").value);
    form.append("dedupe", "true");
    apiDownload("/api/tileset/slice", form, "tileset.zip", "pipelineReport").catch((error) =>
      setText("pipelineReport", error.message),
    );
  });

  $("#runQualityReport")?.addEventListener("click", () => {
    const form = new FormData();
    appendFiles(form, "images", selectedFiles("qualityInput"));
    setText("pipelineReport", "质检中...");
    apiJson("/api/quality/report", form)
      .then((report) => {
        setText("pipelineReport", JSON.stringify(report, null, 2));
        setStatus(`质检完成：${report.count} 个文件，${report.issues.length} 个问题`);
      })
      .catch((error) => setText("pipelineReport", error.message));
  });

  $("#runBatchColor")?.addEventListener("click", () => {
    const form = new FormData();
    appendFiles(form, "images", selectedFiles("qualityInput"));
    form.append("brightness", $("#batchColorBrightness").value);
    form.append("saturation", $("#batchColorSaturation").value);
    form.append("hue", $("#batchColorHue").value);
    apiDownload("/api/batch/color", form, "batch-color.zip", "pipelineReport").catch((error) =>
      setText("pipelineReport", error.message),
    );
  });

  $("#runAudio")?.addEventListener("click", () => {
    const [file] = selectedFiles("audioInput");
    const form = new FormData();
    form.append("audio", file, file.name);
    form.append("operation", $("#audioOperation").value);
    form.append("format", $("#audioFormat").value);
    form.append("bitrate", $("#audioBitrate").value);
    apiDownload("/api/audio/process", form, `audio.${$("#audioFormat").value}`, "audioStatus").catch((error) =>
      setText("audioStatus", error.message),
    );
  });
}

function boot() {
  setupTheme();
  setupRankingWindow();
  setupTabs();
  setupChromaTool();
  setupResizeTool();
  setupInterpolateTool();
  setupVideoTool();
  setupBatchTool();
  setupTrimTool();
  setupPixelScaleTool();
  setupTruePixelTool();
  setupPixelEditorTool();
  setupSequenceTool();
  setupAtlasSliceTool();
  setupExtendedTools();
  renderFrames();
}

boot();

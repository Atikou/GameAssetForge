"use strict";

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const byId = (id) => document.getElementById(id);
  const panel = byId("imagespecPanel");
  if (!panel) return;

  const REGION_LABELS = {
    edit: "局部修改",
    slice: "独立切图",
    protect: "保留区域",
    remove: "删除并补全",
    replace: "替换对象",
    layer: "层级区域",
    expand: "扩图区域",
    color: "颜色调整",
    text: "文字修改",
    review: "验收区域",
  };
  const REGION_COLORS = ["#28c76f", "#ff8a34", "#42a5f5", "#a56eff", "#f14d75", "#16b8a6", "#e8b339"];
  const DATABASE_NAME = "game-asset-forge-imagespec";
  const STORE_NAME = "projects";
  const ACTIVE_KEY = "active-module-project";

  const canvas = byId("imagespecCanvas");
  const stage = byId("imagespecStage");
  const context = canvas.getContext("2d");
  const state = {
    project: null,
    selectedId: null,
    side: "region",
    inspectorTab: "details",
    tool: "select",
    view: { scale: 1, offsetX: 0, offsetY: 0 },
    surface: { width: 1, height: 1, dpr: 1 },
    compareAmount: 0.5,
    pointer: null,
    pending: null,
    polygonPoints: [],
    polygonHover: null,
    polygonCloseReady: false,
    spaceDown: false,
    undo: [],
    redo: [],
    saveTimer: null,
    imageCache: new Map(),
    renderId: 0,
    layerDrag: null,
  };

  function uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function deepClone(value) { return structuredClone(value); }
  function activeVersion() { return state.project?.versions.find((item) => item.id === state.project.activeVersionId) || state.project?.versions[0] || null; }
  function compareVersion() { return state.project?.versions.find((item) => item.id === state.project.compareVersionId) || null; }
  function selectedRegion() { return state.project?.regions.find((item) => item.id === state.selectedId) || null; }
  function safeName(value) { return String(value || "unnamed").trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_") || "unnamed"; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
  function normalizeBounds(bounds) {
    return {
      x: bounds.width < 0 ? bounds.x + bounds.width : bounds.x,
      y: bounds.height < 0 ? bounds.y + bounds.height : bounds.y,
      width: Math.abs(bounds.width),
      height: Math.abs(bounds.height),
    };
  }
  function boundsFromPoints(points) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  function geometryCenter(geometry) { return { x: geometry.bounds.x + geometry.bounds.width / 2, y: geometry.bounds.y + geometry.bounds.height / 2 }; }
  function rotatePoint(point, center, angle) {
    if (!angle) return { ...point };
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return { x: center.x + dx * cosine - dy * sine, y: center.y + dx * sine + dy * cosine };
  }
  function pointToGeometrySpace(point, geometry) { return rotatePoint(point, geometryCenter(geometry), -(geometry.rotation || 0)); }
  function geometryWorldBounds(geometry) {
    if (!geometry.rotation) return { ...geometry.bounds };
    const center = geometryCenter(geometry);
    const { x, y, width, height } = geometry.bounds;
    return boundsFromPoints([
      { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
    ].map((point) => rotatePoint(point, center, geometry.rotation)));
  }

  function makeVersion(name, dataUrl, width, height) {
    return { id: uid("version"), name, dataUrl, width, height, createdAt: new Date().toISOString() };
  }

  function makeProject(version, name) {
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      id: uid("project"),
      name: name || "未命名图片规范",
      createdAt: now,
      updatedAt: now,
      activeVersionId: version.id,
      compareVersionId: null,
      versions: [version],
      groups: [],
      regions: [],
    };
  }

  function makeRegion(geometry) {
    const index = state.project.regions.length;
    const now = new Date().toISOString();
    return {
      id: uid("region"),
      order: index,
      parentId: null,
      layerName: `图层 ${index + 1}`,
      name: `框选 ${index + 1}`,
      type: "edit",
      status: "draft",
      priority: "normal",
      color: REGION_COLORS[index % REGION_COLORS.length],
      visible: true,
      locked: false,
      geometry: { ...geometry, rotation: geometry.rotation || 0 },
      instruction: "",
      prompt: "",
      negativePrompt: "",
      acceptance: "",
      preserveOutside: true,
      slice: { enabled: false, filename: `region_${index + 1}`, format: "png", padding: 0, scale: 1, trimTransparent: false, includeChildren: false, pivotX: 0.5, pivotY: 0.5 },
      createdAt: now,
      updatedAt: now,
    };
  }

  function historySnapshot() {
    if (!state.project) return null;
    return deepClone({
      name: state.project.name,
      groups: state.project.groups,
      regions: state.project.regions,
      activeVersionId: state.project.activeVersionId,
      compareVersionId: state.project.compareVersionId,
    });
  }

  function pushUndo() {
    const snapshot = historySnapshot();
    if (!snapshot) return;
    state.undo.push(snapshot);
    if (state.undo.length > 40) state.undo.shift();
    state.redo = [];
  }

  function restoreSnapshot(snapshot) {
    if (!state.project || !snapshot) return;
    Object.assign(state.project, deepClone(snapshot), { updatedAt: new Date().toISOString() });
    if (!state.project.regions.some((region) => region.id === state.selectedId)) state.selectedId = null;
    scheduleSave();
    renderAll();
  }

  function undo() {
    const previous = state.undo.pop();
    if (!previous || !state.project) return;
    state.redo.push(historySnapshot());
    restoreSnapshot(previous);
  }

  function redo() {
    const next = state.redo.pop();
    if (!next || !state.project) return;
    state.undo.push(historySnapshot());
    restoreSnapshot(next);
  }

  function mutate(recipe, options = {}) {
    if (!state.project) return;
    if (options.history !== false) pushUndo();
    recipe(state.project);
    state.project.updatedAt = new Date().toISOString();
    scheduleSave();
    renderAll();
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveProjectLocally() {
    if (!state.project) return;
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(state.project, ACTIVE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }

  async function loadProjectLocally() {
    const database = await openDatabase();
    const result = await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(ACTIVE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return result;
  }

  function scheduleSave() {
    byId("imagespecSaveState").textContent = "正在自动保存…";
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
      try {
        await saveProjectLocally();
        byId("imagespecSaveState").textContent = "已自动保存到当前浏览器";
      } catch (error) {
        byId("imagespecSaveState").textContent = `保存失败：${error.message}`;
      }
    }, 450);
  }

  function validProject(value) {
    return value && value.schemaVersion === 1 && typeof value.name === "string" && Array.isArray(value.versions) && value.versions.length && Array.isArray(value.regions) && Array.isArray(value.groups);
  }

  function normalizeProject(value) {
    value.compareVersionId ??= null;
    value.groups = value.groups || [];
    value.regions = (value.regions || []).map((region, index) => ({
      ...region,
      order: Number.isFinite(region.order) ? region.order : index,
      layerName: region.layerName || `图层 ${index + 1}`,
      name: region.name || `框选 ${index + 1}`,
      visible: region.visible !== false,
      locked: Boolean(region.locked),
      geometry: { ...region.geometry, rotation: region.geometry?.rotation || 0 },
      slice: { enabled: false, filename: `region_${index + 1}`, format: "png", padding: 0, scale: 1, trimTransparent: false, includeChildren: false, pivotX: 0.5, pivotY: 0.5, ...(region.slice || {}) },
    }));
    return value;
  }

  function imageFromDataUrl(version) {
    if (!version) return Promise.resolve(null);
    if (state.imageCache.has(version.id)) return Promise.resolve(state.imageCache.get(version.id));
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => { state.imageCache.set(version.id, image); resolve(image); };
      image.onerror = reject;
      image.src = version.dataUrl;
    });
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = async () => {
        const dataUrl = String(reader.result);
        const image = new Image();
        image.onerror = reject;
        image.onload = () => resolve({ dataUrl, width: image.naturalWidth, height: image.naturalHeight });
        image.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  async function importImage(file) {
    const result = await readImageFile(file);
    const version = makeVersion(file.name, result.dataUrl, result.width, result.height);
    state.project = makeProject(version, file.name.replace(/\.[^.]+$/, "") || "图片规范");
    state.selectedId = null;
    state.undo = [];
    state.redo = [];
    state.imageCache.clear();
    await imageFromDataUrl(version);
    fitView();
    scheduleSave();
    renderAll();
    toast(`已导入 ${file.name}`);
  }

  async function importCompare(file) {
    if (!state.project) return toast("请先导入原始图片");
    const result = await readImageFile(file);
    pushUndo();
    const version = makeVersion(file.name, result.dataUrl, result.width, result.height);
    state.project.versions.push(version);
    state.project.compareVersionId = version.id;
    state.compareAmount = 0.5;
    byId("imagespecCompareAmount").value = "0.5";
    scheduleSave();
    renderAll();
    toast("已添加修改版，可拖动滑杆对比");
  }

  function createBlank() {
    const work = document.createElement("canvas");
    work.width = 1600;
    work.height = 900;
    const ctx = work.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, work.width, work.height);
    const version = makeVersion("空白画布", work.toDataURL("image/png"), work.width, work.height);
    state.project = makeProject(version, "新图片规范");
    state.selectedId = null;
    state.undo = [];
    state.redo = [];
    state.imageCache.clear();
    fitView();
    scheduleSave();
    renderAll();
    toast("已创建 1600 × 900 空白画布");
  }

  function projectToScreen(point) { return { x: point.x * state.view.scale + state.view.offsetX, y: point.y * state.view.scale + state.view.offsetY }; }
  function screenToProject(point) { return { x: (point.x - state.view.offsetX) / state.view.scale, y: (point.y - state.view.offsetY) / state.view.scale }; }
  function eventScreenPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function eventProjectPoint(event) {
    const version = activeVersion();
    const point = screenToProject(eventScreenPoint(event));
    return version ? { x: clamp(point.x, 0, version.width), y: clamp(point.y, 0, version.height) } : point;
  }

  function fitView() {
    const version = activeVersion();
    if (!version) return;
    const { width, height } = state.surface;
    const scale = Math.max(0.02, Math.min((width - 44) / version.width, (height - 44) / version.height));
    state.view.scale = scale;
    state.view.offsetX = (width - version.width * scale) / 2;
    state.view.offsetY = (height - version.height * scale) / 2;
    updateZoomLabel();
    requestCanvasRender();
  }

  function zoomAt(factor, anchor = { x: state.surface.width / 2, y: state.surface.height / 2 }) {
    if (!state.project) return;
    const before = screenToProject(anchor);
    state.view.scale = clamp(state.view.scale * factor, 0.02, 12);
    state.view.offsetX = anchor.x - before.x * state.view.scale;
    state.view.offsetY = anchor.y - before.y * state.view.scale;
    updateZoomLabel();
    requestCanvasRender();
  }

  function updateZoomLabel() {
    const version = activeVersion();
    if (!version) return;
    const fitted = Math.min((state.surface.width - 44) / version.width, (state.surface.height - 44) / version.height);
    byId("imagespecZoomReset").textContent = `${Math.round((state.view.scale / Math.max(.0001, fitted)) * 100)}%`;
  }

  function groupVisible(groupId) {
    if (!groupId) return true;
    const group = state.project.groups.find((item) => item.id === groupId);
    if (!group) return true;
    return group.visible !== false && groupVisible(group.parentId);
  }
  function groupLocked(groupId) {
    if (!groupId) return false;
    const group = state.project.groups.find((item) => item.id === groupId);
    if (!group) return false;
    return Boolean(group.locked) || groupLocked(group.parentId);
  }
  function regionVisible(region) { return region.visible !== false && groupVisible(region.parentId); }
  function regionLocked(region) { return Boolean(region.locked) || groupLocked(region.parentId); }

  function traceGeometry(ctx, geometry) {
    const { bounds, points, type } = geometry;
    const center = geometryCenter(geometry);
    ctx.beginPath();
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(geometry.rotation || 0);
    ctx.translate(-center.x, -center.y);
    if (type === "ellipse") {
      ctx.ellipse(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, Math.max(1, bounds.width / 2), Math.max(1, bounds.height / 2), 0, 0, Math.PI * 2);
    } else if ((type === "polygon" || type === "brush") && points?.length) {
      ctx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      if (type === "polygon") ctx.closePath();
    } else ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.restore();
  }

  function fillGeometry(ctx, geometry) {
    traceGeometry(ctx, geometry);
    if (geometry.type === "brush") {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = geometry.brushSize || 22;
      ctx.stroke();
    } else ctx.fill();
  }

  function selectionHandles(geometry) {
    const { x, y, width, height } = geometry.bounds;
    const center = geometryCenter(geometry);
    const rotate = (point) => rotatePoint(point, center, geometry.rotation || 0);
    return {
      "north-west": rotate({ x, y }),
      north: rotate({ x: x + width / 2, y }),
      "north-east": rotate({ x: x + width, y }),
      east: rotate({ x: x + width, y: y + height / 2 }),
      "south-east": rotate({ x: x + width, y: y + height }),
      south: rotate({ x: x + width / 2, y: y + height }),
      "south-west": rotate({ x, y: y + height }),
      west: rotate({ x, y: y + height / 2 }),
      rotate: rotate({ x: x + width / 2, y: y - 28 / state.view.scale }),
    };
  }

  function drawRegion(ctx, region, selected = false) {
    if (!regionVisible(region)) return;
    ctx.save();
    if (region.geometry.type === "brush") {
      ctx.strokeStyle = `${region.color}bb`;
      fillGeometry(ctx, region.geometry);
    } else {
      traceGeometry(ctx, region.geometry);
      ctx.fillStyle = `${region.color}${selected ? "38" : "20"}`;
      ctx.fill();
      ctx.strokeStyle = region.color;
      ctx.lineWidth = (selected ? 2.2 : 1.4) / state.view.scale;
      ctx.stroke();
    }
    ctx.restore();
  }

  async function renderCanvas() {
    const renderId = ++state.renderId;
    const { width, height, dpr } = state.surface;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const version = activeVersion();
    if (!version) return;
    const image = await imageFromDataUrl(version).catch(() => null);
    if (renderId !== state.renderId || !image) return;
    context.save();
    context.translate(state.view.offsetX, state.view.offsetY);
    context.scale(state.view.scale, state.view.scale);
    context.drawImage(image, 0, 0, version.width, version.height);
    context.restore();

    const compare = compareVersion();
    if (compare) {
      const compareImage = await imageFromDataUrl(compare).catch(() => null);
      if (renderId !== state.renderId) return;
      if (compareImage) {
        context.save();
        context.beginPath();
        context.rect(0, 0, width * state.compareAmount, height);
        context.clip();
        context.translate(state.view.offsetX, state.view.offsetY);
        context.scale(state.view.scale, state.view.scale);
        context.drawImage(compareImage, 0, 0, version.width, version.height);
        context.restore();
        context.save();
        context.strokeStyle = "#ffffff";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(width * state.compareAmount, 0);
        context.lineTo(width * state.compareAmount, height);
        context.stroke();
        context.restore();
      }
    }

    context.save();
    context.translate(state.view.offsetX, state.view.offsetY);
    context.scale(state.view.scale, state.view.scale);
    [...state.project.regions].sort((a, b) => a.order - b.order).forEach((region) => drawRegion(context, region, region.id === state.selectedId));
    if (state.pending?.geometry) {
      drawRegion(context, { ...makeRegion(state.pending.geometry), color: "#f97316", visible: true }, false);
    }
    if (state.polygonPoints.length) {
      const firstPoint = state.polygonPoints[0];
      context.beginPath();
      context.moveTo(firstPoint.x, firstPoint.y);
      state.polygonPoints.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      if (state.polygonCloseReady && state.polygonPoints.length >= 3) context.lineTo(firstPoint.x, firstPoint.y);
      else if (state.polygonHover) context.lineTo(state.polygonHover.x, state.polygonHover.y);
      context.strokeStyle = state.polygonCloseReady ? "#28c76f" : "#f97316";
      context.lineWidth = 2 / state.view.scale;
      context.stroke();
      state.polygonPoints.forEach((point, index) => {
        context.beginPath();
        context.arc(point.x, point.y, (index === 0 ? (state.polygonCloseReady ? 8 : 5) : 3.5) / state.view.scale, 0, Math.PI * 2);
        context.fillStyle = index === 0 && state.polygonCloseReady ? "#28c76f" : "#ffffff";
        context.fill();
        context.strokeStyle = index === 0 && state.polygonCloseReady ? "#28c76f" : "#f97316";
        context.lineWidth = 2 / state.view.scale;
        context.stroke();
      });
    }
    context.restore();

    const selected = selectedRegion();
    if (selected && regionVisible(selected)) {
      const handles = selectionHandles(selected.geometry);
      context.save();
      context.fillStyle = "#ffffff";
      context.strokeStyle = selected.color;
      context.lineWidth = 2;
      Object.entries(handles).forEach(([name, projectPoint]) => {
        const point = projectToScreen(projectPoint);
        context.beginPath();
        if (name === "rotate") context.arc(point.x, point.y, 5, 0, Math.PI * 2);
        else context.rect(point.x - 4, point.y - 4, 8, 8);
        context.fill();
        context.stroke();
      });
      const top = projectToScreen(handles.north);
      const rotate = projectToScreen(handles.rotate);
      context.beginPath();
      context.moveTo(top.x, top.y);
      context.lineTo(rotate.x, rotate.y);
      context.stroke();
      context.restore();
    }
  }

  let canvasFrame = 0;
  function requestCanvasRender() {
    cancelAnimationFrame(canvasFrame);
    canvasFrame = requestAnimationFrame(renderCanvas);
  }

  function pointInRegion(point, region) {
    const geometry = region.geometry;
    const local = pointToGeometrySpace(point, geometry);
    const { bounds, points, type } = geometry;
    if (type === "ellipse") {
      const rx = bounds.width / 2;
      const ry = bounds.height / 2;
      if (!rx || !ry) return false;
      const dx = local.x - (bounds.x + rx);
      const dy = local.y - (bounds.y + ry);
      return dx * dx / (rx * rx) + dy * dy / (ry * ry) <= 1;
    }
    if (type === "brush" && points?.length) return points.some((candidate) => Math.hypot(candidate.x - local.x, candidate.y - local.y) <= (geometry.brushSize || 22) / 2 + 5);
    if (type === "polygon" && points?.length) {
      let inside = false;
      for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
        const a = points[index];
        const b = points[previous];
        if (a.y > local.y !== b.y > local.y && local.x < ((b.x - a.x) * (local.y - a.y)) / (b.y - a.y || 1) + a.x) inside = !inside;
      }
      return inside;
    }
    return local.x >= bounds.x && local.x <= bounds.x + bounds.width && local.y >= bounds.y && local.y <= bounds.y + bounds.height;
  }

  function hitRegion(point) {
    return [...state.project.regions].sort((a, b) => b.order - a.order).find((region) => regionVisible(region) && pointInRegion(point, region)) || null;
  }

  function hitHandle(screenPoint) {
    const region = selectedRegion();
    if (!region) return null;
    const handles = selectionHandles(region.geometry);
    return Object.entries(handles).find(([, point]) => {
      const screen = projectToScreen(point);
      return Math.hypot(screen.x - screenPoint.x, screen.y - screenPoint.y) <= 9;
    })?.[0] || null;
  }

  function resizeGeometry(original, handle, pointer) {
    const geometry = deepClone(original);
    const center = geometryCenter(geometry);
    const localPointer = pointToGeometrySpace(pointer, geometry);
    const halfWidth = geometry.bounds.width / 2;
    const halfHeight = geometry.bounds.height / 2;
    let left = -halfWidth;
    let right = halfWidth;
    let top = -halfHeight;
    let bottom = halfHeight;
    const minimum = 5;
    if (handle.includes("east")) right = Math.max(localPointer.x - center.x, left + minimum);
    if (handle.includes("west")) left = Math.min(localPointer.x - center.x, right - minimum);
    if (handle.includes("south")) bottom = Math.max(localPointer.y - center.y, top + minimum);
    if (handle.includes("north")) top = Math.min(localPointer.y - center.y, bottom - minimum);
    const width = right - left;
    const height = bottom - top;
    const centerShift = { x: (left + right) / 2, y: (top + bottom) / 2 };
    const worldCenter = rotatePoint({ x: center.x + centerShift.x, y: center.y + centerShift.y }, center, geometry.rotation || 0);
    const scaleX = width / Math.max(1, geometry.bounds.width);
    const scaleY = height / Math.max(1, geometry.bounds.height);
    const points = geometry.points?.map((point) => ({
      x: worldCenter.x + (point.x - center.x) * scaleX,
      y: worldCenter.y + (point.y - center.y) * scaleY,
    }));
    return { ...geometry, bounds: { x: worldCenter.x - width / 2, y: worldCenter.y - height / 2, width, height }, points, brushSize: geometry.brushSize ? geometry.brushSize * (scaleX + scaleY) / 2 : undefined };
  }

  function moveGeometry(original, dx, dy) {
    return {
      ...deepClone(original),
      bounds: { ...original.bounds, x: original.bounds.x + dx, y: original.bounds.y + dy },
      points: original.points?.map((point) => ({ x: point.x + dx, y: point.y + dy })),
    };
  }

  function addRegion(geometry, regionType = null) {
    mutate((project) => {
      const region = makeRegion(geometry);
      if (regionType) region.type = regionType;
      project.regions.push(region);
      state.selectedId = region.id;
      state.side = "region";
      state.inspectorTab = "details";
    });
    setTool("select");
  }

  function finalizePolygon() {
    const points = state.polygonPoints.filter((point, index, all) => index === 0 || Math.hypot(point.x - all[index - 1].x, point.y - all[index - 1].y) > 1);
    state.polygonPoints = [];
    state.polygonHover = null;
    state.polygonCloseReady = false;
    updatePolygonHint();
    if (points.length >= 3) addRegion({ type: "polygon", points, bounds: boundsFromPoints(points), rotation: 0 });
    requestCanvasRender();
  }

  function nearPolygonStart(screenPoint) {
    if (state.polygonPoints.length < 3) return false;
    const first = projectToScreen(state.polygonPoints[0]);
    return Math.hypot(screenPoint.x - first.x, screenPoint.y - first.y) <= 14;
  }

  function updatePolygonHint() {
    const hint = byId("imagespecStageHint");
    stage.classList.toggle("polygon-close-ready", state.tool === "polygon" && state.polygonCloseReady);
    if (state.tool !== "polygon") {
      hint.innerHTML = "<kbd>空格</kbd> 拖动画布 · <kbd>滚轮</kbd> 缩放 · <kbd>Delete</kbd> 删除区域";
      return;
    }
    if (!state.polygonPoints.length) hint.innerHTML = "点击画布添加第一个顶点 · <kbd>双击</kbd> 或 <kbd>Enter</kbd> 也可结束";
    else if (state.polygonPoints.length < 3) hint.innerHTML = `已添加 ${state.polygonPoints.length} 个点 · 至少 3 个点后靠近起点闭合`;
    else if (state.polygonCloseReady) hint.innerHTML = "<strong>点击起点闭合多边形</strong>";
    else hint.innerHTML = `已添加 ${state.polygonPoints.length} 个点 · 移到第一个点自动吸附闭合`;
  }

  function onPointerDown(event) {
    if (!state.project) return;
    const screenPoint = eventScreenPoint(event);
    const point = eventProjectPoint(event);
    canvas.setPointerCapture(event.pointerId);
    if (state.spaceDown || event.button === 1) {
      state.pointer = { mode: "pan", startScreen: screenPoint, startView: { ...state.view } };
      return;
    }
    if (state.tool === "polygon") {
      if (nearPolygonStart(screenPoint)) {
        finalizePolygon();
        return;
      }
      state.polygonPoints.push(point);
      state.polygonHover = point;
      state.polygonCloseReady = false;
      updatePolygonHint();
      requestCanvasRender();
      return;
    }
    if (state.tool === "select") {
      const handle = hitHandle(screenPoint);
      const current = selectedRegion();
      if (handle && current && !regionLocked(current)) {
        pushUndo();
        if (handle === "rotate") {
          const center = geometryCenter(current.geometry);
          state.pointer = { mode: "rotate", regionId: current.id, center, original: deepClone(current.geometry), startAngle: Math.atan2(point.y - center.y, point.x - center.x) };
        } else state.pointer = { mode: "resize", handle, regionId: current.id, original: deepClone(current.geometry) };
        return;
      }
      const hit = hitRegion(point);
      state.selectedId = hit?.id || null;
      state.side = "region";
      if (hit && !regionLocked(hit)) {
        pushUndo();
        state.pointer = { mode: "move", regionId: hit.id, start: point, original: deepClone(hit.geometry) };
      }
      renderAll();
      return;
    }
    if (state.tool === "brush") {
      state.pending = { geometry: { type: "brush", points: [point], bounds: { x: point.x, y: point.y, width: 1, height: 1 }, brushSize: 22, rotation: 0 } };
    } else {
      state.pending = { start: point, regionType: state.tool === "note" ? "review" : null, geometry: { type: state.tool === "note" ? "rect" : state.tool, bounds: { x: point.x, y: point.y, width: 1, height: 1 }, rotation: 0 } };
    }
    state.pointer = { mode: "draw" };
  }

  function onPointerMove(event) {
    if (!state.project) return;
    const screenPoint = eventScreenPoint(event);
    const point = eventProjectPoint(event);
    if (state.tool === "polygon" && state.polygonPoints.length) {
      state.polygonHover = point;
      state.polygonCloseReady = nearPolygonStart(screenPoint);
      updatePolygonHint();
      requestCanvasRender();
    }
    if (!state.pointer) return;
    if (state.pointer.mode === "pan") {
      state.view.offsetX = state.pointer.startView.offsetX + screenPoint.x - state.pointer.startScreen.x;
      state.view.offsetY = state.pointer.startView.offsetY + screenPoint.y - state.pointer.startScreen.y;
      requestCanvasRender();
      return;
    }
    if (state.pointer.mode === "draw" && state.pending) {
      if (state.pending.geometry.type === "brush") {
        state.pending.geometry.points.push(point);
        state.pending.geometry.bounds = boundsFromPoints(state.pending.geometry.points);
      } else state.pending.geometry.bounds = normalizeBounds({ x: state.pending.start.x, y: state.pending.start.y, width: point.x - state.pending.start.x, height: point.y - state.pending.start.y });
      requestCanvasRender();
      return;
    }
    const region = state.project.regions.find((item) => item.id === state.pointer.regionId);
    if (!region) return;
    if (state.pointer.mode === "move") region.geometry = moveGeometry(state.pointer.original, point.x - state.pointer.start.x, point.y - state.pointer.start.y);
    if (state.pointer.mode === "resize") region.geometry = resizeGeometry(state.pointer.original, state.pointer.handle, point);
    if (state.pointer.mode === "rotate") {
      const angle = Math.atan2(point.y - state.pointer.center.y, point.x - state.pointer.center.x);
      region.geometry = { ...deepClone(state.pointer.original), rotation: (state.pointer.original.rotation || 0) + angle - state.pointer.startAngle };
    }
    region.updatedAt = new Date().toISOString();
    requestCanvasRender();
    renderInspector();
    updateStatus();
  }

  function onPointerUp() {
    if (!state.pointer) return;
    const mode = state.pointer.mode;
    state.pointer = null;
    if (mode === "draw" && state.pending) {
      const geometry = state.pending.geometry;
      const regionType = state.pending.regionType;
      state.pending = null;
      if ((geometry.type === "brush" && geometry.points.length > 1) || (geometry.bounds.width * state.view.scale >= 4 && geometry.bounds.height * state.view.scale >= 4)) addRegion(geometry, regionType);
      else requestCanvasRender();
      return;
    }
    if (["move", "resize", "rotate"].includes(mode)) scheduleSave();
    renderAll();
  }

  function setTool(tool) {
    state.tool = tool;
    state.polygonPoints = [];
    state.polygonHover = null;
    state.polygonCloseReady = false;
    stage.dataset.tool = tool;
    $$('[data-imagespec-tool]', panel).forEach((button) => button.classList.toggle("active", button.dataset.imagespecTool === tool));
    updatePolygonHint();
    requestCanvasRender();
  }

  function regionCode(region) {
    const order = [...state.project.regions].sort((a, b) => a.order - b.order).findIndex((item) => item.id === region.id);
    return `R${String(Math.max(0, order) + 1).padStart(2, "0")}`;
  }

  function issues() {
    if (!state.project) return [];
    const result = [];
    if (!state.project.regions.length) result.push({ level: "warn", text: "尚未创建任何标注区域" });
    const filenames = new Set();
    state.project.regions.forEach((region) => {
      if (!region.name.trim()) result.push({ level: "error", text: "存在未命名区域", regionId: region.id });
      if (["edit", "remove", "replace", "color", "text"].includes(region.type) && !region.instruction.trim() && !region.prompt.trim()) result.push({ level: "warn", text: `${region.name} 缺少修改说明`, regionId: region.id });
      if (region.slice.enabled) {
        if (!region.slice.filename.trim()) result.push({ level: "error", text: `${region.name} 缺少切图文件名`, regionId: region.id });
        else if (filenames.has(region.slice.filename)) result.push({ level: "error", text: `切图文件名重复：${region.slice.filename}`, regionId: region.id });
        filenames.add(region.slice.filename);
      }
    });
    if (!result.length) result.push({ level: "ok", text: "当前图片规范通过基础检查" });
    return result;
  }

  function updateStatus() {
    const version = activeVersion();
    byId("imagespecProjectName").value = state.project?.name || "未命名图片规范";
    byId("imagespecCanvasMeta").textContent = version ? `${version.width} × ${version.height}` : "未导入图片";
    byId("imagespecRegionCount").textContent = `${state.project?.regions.length || 0} 个框选`;
    const selected = selectedRegion();
    byId("imagespecSelectionStatus").textContent = selected ? `${regionCode(selected)} · ${selected.name} · ${selected.layerName}` : "未选择区域";
    byId("imagespecEmptyState").classList.toggle("hidden", Boolean(version));
    byId("imagespecCompareControl").classList.toggle("hidden", !compareVersion());
    byId("imagespecIssueBadge").textContent = String(issues().filter((item) => item.level !== "ok").length);
    byId("imagespecUndo").disabled = !state.undo.length;
    byId("imagespecRedo").disabled = !state.redo.length;
    byId("imagespecExportPackage").disabled = !version;
    byId("imagespecSaveProject").disabled = !version;
  }

  function parentOptions(region) {
    const options = ['<option value="">整张图片</option>'];
    state.project.groups.forEach((group) => options.push(`<option value="${escapeHtml(group.id)}" ${region.parentId === group.id ? "selected" : ""}>图层组 · ${escapeHtml(group.name)}</option>`));
    state.project.regions.filter((item) => item.id !== region.id).forEach((item) => options.push(`<option value="${escapeHtml(item.id)}" ${region.parentId === item.id ? "selected" : ""}>${escapeHtml(regionCode(item))} · ${escapeHtml(item.layerName)}</option>`));
    return options.join("");
  }

  function renderRegionInspector() {
    const content = byId("imagespecInspectorContent");
    const region = selectedRegion();
    if (!region) {
      content.innerHTML = '<div class="imagespec-empty-inspector"><span>□</span><strong>选择或画出一个区域</strong><p>区域用于说明哪里要修改、保护或独立切图。</p><p>快捷键：R 矩形 · E 椭圆 · P 多边形 · B 画笔 · N 注释</p></div>';
      return;
    }
    const geometry = region.geometry;
    const tabButtons = [["details", "属性"], ["ai", "AI 说明"], ["slice", "切图"]].map(([id, label]) => `<button type="button" data-inspector-tab="${id}" class="${state.inspectorTab === id ? "active" : ""}">${label}</button>`).join("");
    let form = "";
    if (state.inspectorTab === "details") {
      form = `<div class="imagespec-form">
        <label class="field"><span>用途</span><select data-region-field="type">${Object.entries(REGION_LABELS).map(([value, label]) => `<option value="${value}" ${region.type === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="field"><span>所属图层</span><select data-region-field="parentId">${parentOptions(region)}</select></label>
        <div class="field-grid three">
          <label class="field"><span>优先级</span><select data-region-field="priority"><option value="low" ${region.priority === "low" ? "selected" : ""}>低</option><option value="normal" ${region.priority === "normal" ? "selected" : ""}>普通</option><option value="high" ${region.priority === "high" ? "selected" : ""}>高</option></select></label>
          <label class="field"><span>状态</span><select data-region-field="status"><option value="draft" ${region.status === "draft" ? "selected" : ""}>草稿</option><option value="ready" ${region.status === "ready" ? "selected" : ""}>已确认</option><option value="done" ${region.status === "done" ? "selected" : ""}>已完成</option></select></label>
          <label class="field"><span>标记色</span><input type="color" data-region-field="color" value="${escapeHtml(region.color)}" /></label>
        </div>
        <div class="imagespec-geometry-card"><div><span>X</span><b>${Math.round(geometry.bounds.x)}</b></div><div><span>Y</span><b>${Math.round(geometry.bounds.y)}</b></div><div><span>W</span><b>${Math.round(geometry.bounds.width)}</b></div><div><span>H</span><b>${Math.round(geometry.bounds.height)}</b></div><div><span>旋转</span><b>${Math.round((geometry.rotation || 0) * 180 / Math.PI)}°</b></div></div>
        <p class="imagespec-form-note">拖动边框或角点缩放；拖动上方圆点旋转；锁定图层后画布不可修改。</p>
        <label class="field"><span>区域说明</span><textarea data-region-field="instruction" placeholder="说明需要修改或保留的内容">${escapeHtml(region.instruction)}</textarea></label>
        <label class="imagespec-switch-row"><span><strong>保护区域外内容</strong><span>要求修改时不改变选区外像素</span></span><input type="checkbox" data-region-field="preserveOutside" ${region.preserveOutside ? "checked" : ""} /></label>
      </div>`;
    } else if (state.inspectorTab === "ai") {
      form = `<div class="imagespec-form">
        <div class="imagespec-ai-tip">提示词会与编号标注图、区域蒙版一起导出，避免“左边那个东西”之类的歧义。</div>
        <label class="field"><span>正向提示词</span><textarea class="imagespec-large" data-region-field="prompt" placeholder="希望改变什么，并说明必须保持的风格与结构">${escapeHtml(region.prompt)}</textarea></label>
        <label class="field"><span>负面提示词</span><textarea data-region-field="negativePrompt" placeholder="禁止出现什么、禁止修改哪些内容">${escapeHtml(region.negativePrompt)}</textarea></label>
        <label class="field"><span>验收标准</span><textarea data-region-field="acceptance" placeholder="例如：边缘无白边；区域外像素一致">${escapeHtml(region.acceptance)}</textarea></label>
        <button id="imagespecComposePrompt" type="button">根据区域说明整理提示词</button>
      </div>`;
    } else {
      form = `<div class="imagespec-form">
        <label class="imagespec-switch-row"><span><strong>启用独立切图</strong><span>导出需求包时生成透明裁切文件</span></span><input type="checkbox" data-slice-field="enabled" ${region.slice.enabled ? "checked" : ""} /></label>
        <label class="field"><span>文件名</span><input data-slice-field="filename" value="${escapeHtml(region.slice.filename)}" /></label>
        <div class="field-grid"><label class="field"><span>格式</span><select data-slice-field="format"><option value="png" ${region.slice.format === "png" ? "selected" : ""}>PNG</option><option value="webp" ${region.slice.format === "webp" ? "selected" : ""}>WebP</option><option value="jpg" ${region.slice.format === "jpg" ? "selected" : ""}>JPG</option></select></label><label class="field"><span>倍率</span><select data-slice-field="scale"><option value="1" ${region.slice.scale === 1 ? "selected" : ""}>1×</option><option value="2" ${region.slice.scale === 2 ? "selected" : ""}>2×</option><option value="3" ${region.slice.scale === 3 ? "selected" : ""}>3×</option></select></label></div>
        <div class="field-grid"><label class="field"><span>留白 px</span><input type="number" min="0" max="256" data-slice-field="padding" value="${region.slice.padding}" /></label><label class="field"><span>Pivot X</span><input type="number" min="0" max="1" step="0.05" data-slice-field="pivotX" value="${region.slice.pivotX}" /></label></div>
        <label class="field"><span>Pivot Y</span><input type="range" min="0" max="1" step="0.05" data-slice-field="pivotY" value="${region.slice.pivotY}" /></label>
        <label class="imagespec-switch-row"><span><strong>包含子区域</strong><span>父区域切图时合并所有后代选区</span></span><input type="checkbox" data-slice-field="includeChildren" ${region.slice.includeChildren ? "checked" : ""} /></label>
        <p class="imagespec-form-note">预计尺寸：${Math.round((geometry.bounds.width + region.slice.padding * 2) * region.slice.scale)} × ${Math.round((geometry.bounds.height + region.slice.padding * 2) * region.slice.scale)} px</p>
      </div>`;
    }
    content.innerHTML = `<div class="imagespec-inspector-heading"><div><small>REGION</small><input id="imagespecRegionTitle" value="${escapeHtml(region.name)}" aria-label="区域名称" /></div><span class="imagespec-region-code" style="border-color:${escapeHtml(region.color)}">${regionCode(region)}</span></div><div class="imagespec-inspector-tabs">${tabButtons}</div>${form}<button id="imagespecDeleteRegion" class="imagespec-danger" type="button">删除当前框选</button>`;
    bindRegionInspector(region);
  }

  function fieldValue(input) {
    if (input.type === "checkbox") return input.checked;
    if (input.type === "number" || input.type === "range") return Number(input.value);
    return input.value;
  }

  function bindRegionInspector(region) {
    $$('[data-inspector-tab]', byId("imagespecInspectorContent")).forEach((button) => button.addEventListener("click", () => { state.inspectorTab = button.dataset.inspectorTab; renderInspector(); }));
    const bindLiveText = (input, apply) => {
      let captured = false;
      input.addEventListener("focus", () => {
        if (!captured) { pushUndo(); captured = true; }
      });
      input.addEventListener("input", () => {
        apply(fieldValue(input));
        state.project.updatedAt = new Date().toISOString();
        scheduleSave();
        updateStatus();
        requestCanvasRender();
      });
    };
    const title = byId("imagespecRegionTitle");
    if (title) bindLiveText(title, (value) => { const target = state.project.regions.find((item) => item.id === region.id); if (target) target.name = value; });
    $$('[data-region-field]', byId("imagespecInspectorContent")).forEach((input) => {
      const field = input.dataset.regionField;
      const isText = input.tagName === "TEXTAREA" || (input.tagName === "INPUT" && !["checkbox", "color", "number", "range"].includes(input.type));
      if (isText) bindLiveText(input, (value) => { const target = state.project.regions.find((item) => item.id === region.id); if (target) { target[field] = value; target.updatedAt = new Date().toISOString(); } });
      else input.addEventListener("change", () => mutate((project) => {
        const target = project.regions.find((item) => item.id === region.id);
        const value = fieldValue(input);
        target[field] = field === "parentId" && !value ? null : value;
        target.updatedAt = new Date().toISOString();
      }));
    });
    $$('[data-slice-field]', byId("imagespecInspectorContent")).forEach((input) => {
      const field = input.dataset.sliceField;
      const isText = input.tagName === "INPUT" && !["checkbox", "color", "number", "range"].includes(input.type);
      if (isText) bindLiveText(input, (value) => { const target = state.project.regions.find((item) => item.id === region.id); if (target) { target.slice[field] = value; target.updatedAt = new Date().toISOString(); } });
      else input.addEventListener("change", () => mutate((project) => {
        const target = project.regions.find((item) => item.id === region.id);
        target.slice[field] = fieldValue(input);
        target.updatedAt = new Date().toISOString();
      }));
    });
    byId("imagespecComposePrompt")?.addEventListener("click", () => mutate((project) => {
      const target = project.regions.find((item) => item.id === region.id);
      target.prompt ||= `${REGION_LABELS[target.type]}“${target.name}”，${target.instruction || "保持构图、透视和原始风格一致"}。`;
      if (target.preserveOutside) target.negativePrompt ||= "不要修改区域外内容，不要改变画布尺寸。";
    }));
    byId("imagespecDeleteRegion")?.addEventListener("click", () => deleteRegion(region.id));
  }

  function deleteRegion(id) {
    mutate((project) => {
      const target = project.regions.find((item) => item.id === id);
      project.regions = project.regions.filter((item) => item.id !== id).map((item, order) => ({ ...item, order, parentId: item.parentId === id ? target?.parentId || null : item.parentId }));
      state.selectedId = null;
    });
  }

  function renderLayers() {
    const content = byId("imagespecInspectorContent");
    const rootGroups = state.project.groups.filter((item) => !item.parentId);
    const rootRegions = state.project.regions.filter((item) => !item.parentId);
    const renderRegion = (region, depth) => {
      const children = state.project.regions.filter((item) => item.parentId === region.id).sort((a, b) => a.order - b.order);
      return `<div class="imagespec-layer-row ${state.selectedId === region.id ? "active" : ""}" style="--depth:${depth}" draggable="true" data-layer-id="${escapeHtml(region.id)}" data-layer-kind="region"><button type="button" data-layer-visible="${escapeHtml(region.id)}">${region.visible ? "◉" : "○"}</button><span class="imagespec-layer-swatch" style="background:${escapeHtml(region.color)}"></span><div class="imagespec-layer-copy" data-layer-select="${escapeHtml(region.id)}"><strong>${escapeHtml(region.layerName)}</strong><small>${escapeHtml(regionCode(region))} · ${escapeHtml(region.name)}</small></div><div class="imagespec-layer-actions"><button type="button" data-layer-lock="${escapeHtml(region.id)}">${region.locked ? "▣" : "▢"}</button><button type="button" data-layer-delete="${escapeHtml(region.id)}">×</button></div></div>${children.map((child) => renderRegion(child, depth + 1)).join("")}`;
    };
    const renderGroup = (group, depth) => {
      const groups = state.project.groups.filter((item) => item.parentId === group.id);
      const regions = state.project.regions.filter((item) => item.parentId === group.id).sort((a, b) => a.order - b.order);
      return `<div class="imagespec-layer-row" style="--depth:${depth}" draggable="true" data-layer-id="${escapeHtml(group.id)}" data-layer-kind="group"><button type="button" data-group-visible="${escapeHtml(group.id)}">${group.visible ? "◉" : "○"}</button><span>▸</span><div class="imagespec-layer-copy" data-group-rename="${escapeHtml(group.id)}"><strong>${escapeHtml(group.name)}</strong><small>图层组</small></div><div class="imagespec-layer-actions"><button type="button" data-group-lock="${escapeHtml(group.id)}">${group.locked ? "▣" : "▢"}</button><button type="button" data-group-delete="${escapeHtml(group.id)}">×</button></div></div>${groups.map((child) => renderGroup(child, depth + 1)).join("")}${regions.map((region) => renderRegion(region, depth + 1)).join("")}`;
    };
    content.innerHTML = `<div class="imagespec-layer-toolbar"><div><small>LAYERS</small><h3>图片结构</h3></div><button id="imagespecAddGroup" type="button">＋ 图层组</button></div><p class="imagespec-layer-help">拖到图层组内归类 · 双击名称重命名 · 眼睛显示 · 方框锁定</p><div class="imagespec-layer-list"><div class="imagespec-layer-root" data-layer-root>整张图片 · ${state.project.regions.length} 个图层</div>${rootGroups.map((group) => renderGroup(group, 0)).join("")}${rootRegions.sort((a, b) => a.order - b.order).map((region) => renderRegion(region, 0)).join("")}</div>`;
    bindLayers();
  }

  function bindLayers() {
    byId("imagespecAddGroup")?.addEventListener("click", () => mutate((project) => { project.groups.push({ id: uid("group"), parentId: null, order: project.groups.length, name: `图层组 ${project.groups.length + 1}`, visible: true, locked: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); }));
    $$('[data-layer-select]', panel).forEach((element) => {
      element.addEventListener("click", () => { state.selectedId = element.dataset.layerSelect; state.side = "region"; renderAll(); });
      element.addEventListener("dblclick", () => {
        const region = state.project.regions.find((item) => item.id === element.dataset.layerSelect);
        const name = prompt("图层名称", region.layerName);
        if (name?.trim()) mutate(() => { region.layerName = name.trim(); });
      });
    });
    $$('[data-layer-visible]', panel).forEach((button) => button.addEventListener("click", () => mutate((project) => { const item = project.regions.find((region) => region.id === button.dataset.layerVisible); item.visible = !item.visible; })));
    $$('[data-layer-lock]', panel).forEach((button) => button.addEventListener("click", () => mutate((project) => { const item = project.regions.find((region) => region.id === button.dataset.layerLock); item.locked = !item.locked; })));
    $$('[data-layer-delete]', panel).forEach((button) => button.addEventListener("click", () => deleteRegion(button.dataset.layerDelete)));
    $$('[data-group-rename]', panel).forEach((element) => element.addEventListener("dblclick", () => {
      const group = state.project.groups.find((item) => item.id === element.dataset.groupRename);
      const name = prompt("图层组名称", group.name);
      if (name?.trim()) mutate(() => { group.name = name.trim(); });
    }));
    $$('[data-group-visible]', panel).forEach((button) => button.addEventListener("click", () => mutate((project) => { const item = project.groups.find((group) => group.id === button.dataset.groupVisible); item.visible = !item.visible; })));
    $$('[data-group-lock]', panel).forEach((button) => button.addEventListener("click", () => mutate((project) => { const item = project.groups.find((group) => group.id === button.dataset.groupLock); item.locked = !item.locked; })));
    $$('[data-group-delete]', panel).forEach((button) => button.addEventListener("click", () => mutate((project) => {
      const id = button.dataset.groupDelete;
      const group = project.groups.find((item) => item.id === id);
      project.groups = project.groups.filter((item) => item.id !== id).map((item) => ({ ...item, parentId: item.parentId === id ? group.parentId : item.parentId }));
      project.regions = project.regions.map((item) => ({ ...item, parentId: item.parentId === id ? group.parentId : item.parentId }));
    })));
    $$('[draggable="true"]', byId("imagespecInspectorContent")).forEach((row) => {
      row.addEventListener("dragstart", () => { state.layerDrag = { id: row.dataset.layerId, kind: row.dataset.layerKind }; });
      row.addEventListener("dragover", (event) => { if (state.layerDrag && row.dataset.layerKind === "group") event.preventDefault(); });
      row.addEventListener("drop", (event) => {
        if (!state.layerDrag || row.dataset.layerKind !== "group") return;
        event.preventDefault();
        mutate((project) => {
          const list = state.layerDrag.kind === "group" ? project.groups : project.regions;
          const item = list.find((candidate) => candidate.id === state.layerDrag.id);
          if (item && item.id !== row.dataset.layerId) item.parentId = row.dataset.layerId;
        });
        state.layerDrag = null;
      });
    });
    $('[data-layer-root]', panel)?.addEventListener("dragover", (event) => event.preventDefault());
    $('[data-layer-root]', panel)?.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!state.layerDrag) return;
      mutate((project) => { const list = state.layerDrag.kind === "group" ? project.groups : project.regions; const item = list.find((candidate) => candidate.id === state.layerDrag.id); if (item) item.parentId = null; });
      state.layerDrag = null;
    });
  }

  function renderReview() {
    const content = byId("imagespecInspectorContent");
    const allIssues = issues();
    const ready = state.project.regions.length ? Math.round(state.project.regions.filter((region) => region.status === "ready" || region.status === "done").length / state.project.regions.length * 100) : 0;
    content.innerHTML = `<div class="imagespec-layer-toolbar"><div><small>REVIEW</small><h3>导出前检查 · ${ready}%</h3></div></div><div class="imagespec-progress"><span style="width:${ready}%"></span></div><div class="imagespec-review-summary"><div><span>蒙版</span><b>${state.project.regions.length}</b></div><div><span>切图</span><b>${state.project.regions.filter((region) => region.slice.enabled).length}</b></div><div><span>说明</span><b>${state.project.regions.filter((region) => region.instruction || region.prompt).length}</b></div></div><p class="imagespec-layer-help">已确认或完成的区域计入完成度；错误项应在导出前处理。</p><div class="imagespec-issue-list">${allIssues.map((issue) => `<button type="button" class="imagespec-issue ${issue.level}" ${issue.regionId ? `data-issue-region="${escapeHtml(issue.regionId)}"` : ""}><span>${issue.level === "ok" ? "✓" : "!"}</span><b>${escapeHtml(issue.text)}</b></button>`).join("")}</div>`;
    $$('[data-issue-region]', content).forEach((button) => button.addEventListener("click", () => { state.selectedId = button.dataset.issueRegion; state.side = "region"; renderAll(); }));
  }

  function renderInspector() {
    if (!state.project) {
      byId("imagespecInspectorContent").innerHTML = '<div class="imagespec-empty-inspector"><span>IS</span><strong>ImageSpec 图片规范</strong><p>无需外部工程。导入图片即可在当前模块中开始标注和切图。</p></div>';
      return;
    }
    if (state.side === "layers") renderLayers();
    else if (state.side === "review") renderReview();
    else renderRegionInspector();
  }

  function renderAll() {
    $$('[data-imagespec-side]', panel).forEach((button) => button.classList.toggle("active", button.dataset.imagespecSide === state.side));
    updateStatus();
    renderInspector();
    requestCanvasRender();
  }

  function canvasBlob(work, type = "image/png", quality = .92) {
    return new Promise((resolve, reject) => work.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成图片")), type, quality));
  }
  function dataUrlToBlob(dataUrl) {
    const [header, encoded] = dataUrl.split(",");
    const mime = header.match(/:(.*?);/)?.[1] || "image/png";
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mime });
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  function serializeProject() { return JSON.stringify(state.project, null, 2); }
  function downloadProject() { if (state.project) downloadBlob(new Blob([serializeProject()], { type: "application/json" }), `${safeName(state.project.name)}.imagespec.json`); }

  async function annotatedPreview(image) {
    const version = activeVersion();
    const work = document.createElement("canvas");
    work.width = version.width;
    work.height = version.height;
    const ctx = work.getContext("2d");
    ctx.drawImage(image, 0, 0, version.width, version.height);
    const fontSize = Math.max(12, Math.round(version.width / 80));
    state.project.regions.forEach((region) => {
      if (!regionVisible(region)) return;
      ctx.save();
      if (region.geometry.type === "brush") { ctx.strokeStyle = `${region.color}aa`; fillGeometry(ctx, region.geometry); }
      else { traceGeometry(ctx, region.geometry); ctx.fillStyle = `${region.color}28`; ctx.fill(); ctx.strokeStyle = region.color; ctx.lineWidth = Math.max(2, version.width / 900); ctx.stroke(); }
      ctx.restore();
      const bounds = geometryWorldBounds(region.geometry);
      const label = `${regionCode(region)} · ${region.name}`;
      ctx.font = `700 ${fontSize}px Arial`;
      const width = ctx.measureText(label).width + fontSize;
      ctx.fillStyle = region.color;
      ctx.fillRect(bounds.x, Math.max(0, bounds.y - fontSize * 1.7), width, fontSize * 1.7);
      ctx.fillStyle = "#07110b";
      ctx.fillText(label, bounds.x + fontSize / 2, Math.max(fontSize * 1.2, bounds.y - fontSize * .4));
    });
    return canvasBlob(work);
  }

  async function regionMap() {
    const version = activeVersion();
    const work = document.createElement("canvas");
    work.width = version.width;
    work.height = version.height;
    const ctx = work.getContext("2d");
    ctx.fillStyle = "#13241b";
    ctx.fillRect(0, 0, work.width, work.height);
    state.project.regions.forEach((region) => {
      ctx.save();
      ctx.fillStyle = `${region.color}aa`;
      ctx.strokeStyle = "#ffffff";
      fillGeometry(ctx, region.geometry);
      if (region.geometry.type !== "brush") ctx.stroke();
      const center = geometryCenter(region.geometry);
      ctx.fillStyle = "#ffffff";
      ctx.font = `900 ${Math.max(14, version.width / 65)}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText(regionCode(region), center.x, center.y);
      ctx.restore();
    });
    return canvasBlob(work);
  }

  async function regionMask(region) {
    const version = activeVersion();
    const work = document.createElement("canvas");
    work.width = version.width;
    work.height = version.height;
    const ctx = work.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, work.width, work.height);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    fillGeometry(ctx, region.geometry);
    return canvasBlob(work);
  }

  function descendants(region) {
    const result = [region];
    if (!region.slice.includeChildren) return result;
    const ids = new Set([region.id]);
    let changed = true;
    while (changed) {
      changed = false;
      state.project.regions.forEach((candidate) => {
        if (candidate.parentId && ids.has(candidate.parentId) && !ids.has(candidate.id)) { ids.add(candidate.id); result.push(candidate); changed = true; }
      });
    }
    return result;
  }

  async function regionCrop(region, image) {
    const version = activeVersion();
    const included = descendants(region);
    const allBounds = included.map((item) => geometryWorldBounds(item.geometry));
    const padding = Math.max(0, region.slice.padding);
    const minX = Math.max(0, Math.floor(Math.min(...allBounds.map((item) => item.x)) - padding));
    const minY = Math.max(0, Math.floor(Math.min(...allBounds.map((item) => item.y)) - padding));
    const maxX = Math.min(version.width, Math.ceil(Math.max(...allBounds.map((item) => item.x + item.width)) + padding));
    const maxY = Math.min(version.height, Math.ceil(Math.max(...allBounds.map((item) => item.y + item.height)) + padding));
    const sourceWidth = Math.max(1, maxX - minX);
    const sourceHeight = Math.max(1, maxY - minY);
    const scale = Number(region.slice.scale) || 1;
    const work = document.createElement("canvas");
    work.width = Math.max(1, Math.round(sourceWidth * scale));
    work.height = Math.max(1, Math.round(sourceHeight * scale));
    const ctx = work.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(image, minX, minY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
    const mask = document.createElement("canvas");
    mask.width = work.width;
    mask.height = work.height;
    const maskContext = mask.getContext("2d");
    maskContext.scale(scale, scale);
    maskContext.translate(-minX, -minY);
    maskContext.fillStyle = "#fff";
    maskContext.strokeStyle = "#fff";
    included.forEach((item) => fillGeometry(maskContext, item.geometry));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0);
    const type = region.slice.format === "jpg" ? "image/jpeg" : `image/${region.slice.format}`;
    if (region.slice.format === "jpg") {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, work.width, work.height);
    }
    return canvasBlob(work, type);
  }

  function aiRequest() {
    const lines = [`# ${state.project.name} — AI 图片修改与切图说明`, "", `共 ${state.project.regions.length} 个标注区域。编号与 annotated-preview.png、region-map.png 一致。`, ""];
    state.project.regions.forEach((region) => {
      lines.push(`## ${regionCode(region)} · ${region.name}`, `- 图层名称：${region.layerName}`, `- 操作：${REGION_LABELS[region.type]}`, `- 优先级：${region.priority}`, `- 区域外保护：${region.preserveOutside ? "是" : "否"}`);
      if (region.instruction) lines.push(`- 修改说明：${region.instruction}`);
      if (region.prompt) lines.push(`- AI 提示词：${region.prompt}`);
      if (region.negativePrompt) lines.push(`- 禁止内容：${region.negativePrompt}`);
      if (region.acceptance) lines.push(`- 验收标准：${region.acceptance}`);
      if (region.slice.enabled) lines.push(`- 切图：${region.slice.filename}.${region.slice.format}，${region.slice.scale}x，留白 ${region.slice.padding}px`);
      lines.push("");
    });
    return lines.join("\n");
  }

  async function exportPackage() {
    if (!state.project) return;
    const button = byId("imagespecExportPackage");
    button.disabled = true;
    button.textContent = "正在整理…";
    try {
      const version = activeVersion();
      const image = await imageFromDataUrl(version);
      const files = [];
      const addFile = (name, data) => files.push({ name, data });
      addFile("project.json", serializeProject());
      addFile("manifest.json", JSON.stringify({
        schemaVersion: 1,
        projectId: state.project.id,
        image: { width: version.width, height: version.height, version: version.name },
        groups: state.project.groups,
        regions: state.project.regions.map((region) => ({ id: region.id, code: regionCode(region), name: region.name, layerName: region.layerName, parentId: region.parentId, zOrder: region.order, type: region.type, geometry: region.geometry, normalizedBounds: (() => { const bounds = geometryWorldBounds(region.geometry); return { x: bounds.x / version.width, y: bounds.y / version.height, width: bounds.width / version.width, height: bounds.height / version.height }; })(), instruction: region.instruction, slice: region.slice })),
      }, null, 2));
      addFile("ai-request.md", aiRequest());
      addFile(`original.${version.dataUrl.startsWith("data:image/jpeg") ? "jpg" : "png"}`, dataUrlToBlob(version.dataUrl));
      addFile("annotated-preview.png", await annotatedPreview(image));
      addFile("region-map.png", await regionMap());
      for (let index = 0; index < state.project.regions.length; index += 1) {
        const region = state.project.regions[index];
        button.textContent = `区域 ${index + 1}/${state.project.regions.length}`;
        addFile(`masks/${regionCode(region)}_${safeName(region.name)}.png`, await regionMask(region));
        if (region.slice.enabled) addFile(`crops/${safeName(region.slice.filename)}.${region.slice.format}`, await regionCrop(region, image));
      }
      button.textContent = "正在压缩…";
      const blob = await window.ImageSpecZip.createZipBlob(files);
      downloadBlob(blob, `${safeName(state.project.name)}_imagespec.zip`);
      toast("需求包已导出");
    } catch (error) {
      toast(`导出失败：${error.message}`);
    } finally {
      button.textContent = "导出需求包";
      button.disabled = false;
    }
  }

  let toastTimer = 0;
  function toast(message) {
    $(".imagespec-toast")?.remove();
    const element = document.createElement("div");
    element.className = "imagespec-toast";
    element.setAttribute("role", "status");
    element.textContent = message;
    document.body.appendChild(element);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.remove(), 2800);
  }

  function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const hadSize = state.surface.width > 1;
    state.surface = { width: Math.max(1, rect.width), height: Math.max(1, rect.height), dpr };
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    if (!hadSize && state.project) fitView();
    else requestCanvasRender();
  }

  $$('[data-imagespec-tool]', panel).forEach((button) => button.addEventListener("click", () => setTool(button.dataset.imagespecTool)));
  $$('[data-imagespec-side]', panel).forEach((button) => button.addEventListener("click", () => { state.side = button.dataset.imagespecSide; renderAll(); }));
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("dblclick", () => { if (state.tool === "polygon") finalizePolygon(); });
  canvas.addEventListener("pointerleave", () => {
    if (state.tool !== "polygon" || !state.polygonCloseReady) return;
    state.polygonCloseReady = false;
    updatePolygonHint();
    requestCanvasRender();
  });
  canvas.addEventListener("wheel", (event) => { event.preventDefault(); zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, eventScreenPoint(event)); }, { passive: false });
  byId("imagespecFit").addEventListener("click", fitView);
  byId("imagespecZoomOut").addEventListener("click", () => zoomAt(1 / 1.15));
  byId("imagespecZoomIn").addEventListener("click", () => zoomAt(1.15));
  byId("imagespecZoomReset").addEventListener("click", fitView);
  byId("imagespecUndo").addEventListener("click", undo);
  byId("imagespecRedo").addEventListener("click", redo);
  byId("imagespecNew").addEventListener("click", createBlank);
  byId("imagespecSaveProject").addEventListener("click", downloadProject);
  byId("imagespecExportPackage").addEventListener("click", exportPackage);
  byId("imagespecProjectName").addEventListener("change", (event) => mutate((project) => { project.name = event.target.value.trim() || "未命名图片规范"; }));
  byId("imagespecCompareAmount").addEventListener("input", (event) => { state.compareAmount = Number(event.target.value); requestCanvasRender(); });
  byId("imagespecEndCompare").addEventListener("click", () => mutate((project) => { project.compareVersionId = null; }));

  [byId("imagespecImageInput"), byId("imagespecEmptyImageInput")].forEach((input) => input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) await importImage(file).catch((error) => toast(`无法导入图片：${error.message}`));
  }));
  byId("imagespecCompareInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await importCompare(file).catch((error) => toast(`无法导入对比图：${error.message}`));
  });
  byId("imagespecProjectInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!validProject(parsed)) throw new Error("不是有效的 ImageSpec 图片规范");
      state.project = normalizeProject(parsed);
      state.selectedId = state.project.regions[0]?.id || null;
      state.undo = [];
      state.redo = [];
      state.imageCache.clear();
      await imageFromDataUrl(activeVersion());
      fitView();
      scheduleSave();
      renderAll();
      toast("图片规范已恢复");
    } catch (error) { toast(`无法打开：${error.message}`); }
  });

  window.addEventListener("keydown", (event) => {
    if (!panel.classList.contains("active")) return;
    const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (event.code === "Space" && !editing) { event.preventDefault(); state.spaceDown = true; }
    if (editing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
    const tool = { v: "select", r: "rect", e: "ellipse", p: "polygon", b: "brush", n: "note" }[event.key.toLowerCase()];
    if (tool) setTool(tool);
    if (event.key === "Enter" && state.tool === "polygon") finalizePolygon();
    if (event.key === "Escape") { state.polygonPoints = []; state.polygonHover = null; state.polygonCloseReady = false; state.pending = null; updatePolygonHint(); requestCanvasRender(); }
    if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) { event.preventDefault(); deleteRegion(state.selectedId); }
  });
  window.addEventListener("keyup", (event) => { if (event.code === "Space") state.spaceDown = false; });
  new ResizeObserver(resizeCanvas).observe(stage);

  stage.dataset.tool = "select";
  loadProjectLocally().then(async (stored) => {
    if (validProject(stored)) {
      state.project = normalizeProject(stored);
      state.selectedId = state.project.regions[0]?.id || null;
      await imageFromDataUrl(activeVersion()).catch(() => null);
      fitView();
    }
    renderAll();
  }).catch(() => renderAll());
  resizeCanvas();
})();

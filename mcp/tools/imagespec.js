"use strict";

const z = require("zod/v4");

const { ImageSpecService } = require("../../imagespec/core");

function mcpText(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function registerImageSpecTools(server, options = {}) {
  const service = options.service || new ImageSpecService();

  server.registerTool(
    "imagespec_project_create",
    {
      title: "创建 ImageSpec 工程",
      description: "创建文件系统权威的 *.project.imagespec 工程。",
      inputSchema: {
        projectPath: z.string(),
        name: z.string().min(1),
        projectId: z.string().optional(),
        width: z.number().int().min(1).max(65535).default(1024),
        height: z.number().int().min(1).max(65535).default(1024),
        description: z.string().default(""),
      },
    },
    async (args) => mcpText(await service.createProject(args.projectPath, args)),
  );

  server.registerTool(
    "imagespec_project_inspect",
    {
      title: "检查 ImageSpec 工程",
      description: "只读检查工程 revision、资产数量、计划、回执、锁和待恢复事务。",
      inputSchema: { projectPath: z.string() },
    },
    async (args) => mcpText(await service.inspectProject(args.projectPath)),
  );

  server.registerTool(
    "imagespec_asset_find",
    {
      title: "查找 ImageSpec 资产",
      description: "按稳定 ID、名称或标签查找 AssetNode。",
      inputSchema: { projectPath: z.string(), query: z.string().default("") },
    },
    async (args) => mcpText({ assets: await service.findAssets(args.projectPath, args.query) }),
  );

  server.registerTool(
    "imagespec_capabilities",
    {
      title: "列出 ImageSpec Runner 能力",
      description: "只读返回当前 Runner 能力、版本和是否需要批准。",
      inputSchema: {},
    },
    async () => mcpText({ capabilities: service.listCapabilities() }),
  );

  server.registerTool(
    "imagespec_plan_create",
    {
      title: "创建 ImageSpec OperationPlan",
      description: "把已经标准化的操作保存为带 revision、影响范围和预览的计划；本工具不理解自然语言。",
      inputSchema: {
        projectPath: z.string(),
        plan: z.record(z.string(), z.unknown()),
      },
    },
    async (args) => mcpText(await service.createPlan(args.projectPath, args.plan)),
  );

  server.registerTool(
    "imagespec_plan_preview",
    {
      title: "预览 ImageSpec Plan",
      description: "只读计算计划将影响的资产、文件和字段。",
      inputSchema: { projectPath: z.string(), planId: z.string() },
    },
    async (args) => mcpText(await service.previewPlan(args.projectPath, args.planId)),
  );

  server.registerTool(
    "imagespec_plan_apply",
    {
      title: "应用 ImageSpec Plan",
      description: "事务式应用计划并返回 Receipt；需要批准的计划必须显式传 approved=true。",
      inputSchema: {
        projectPath: z.string(),
        planId: z.string(),
        approved: z.boolean().default(false),
        approvalId: z.string().optional(),
      },
    },
    async (args) =>
      mcpText(
        await service.applyPlan(args.projectPath, args.planId, {
          approved: args.approved,
          approval: args.approved ? { id: args.approvalId || `mcp.${Date.now()}` } : null,
        }),
      ),
  );

  server.registerTool(
    "imagespec_validate",
    {
      title: "验证 ImageSpec 工程",
      description: "运行 Schema、图、路径、Hash、Alpha、边缘、Pivot 和九宫格检查；apply=true 时写入 Receipt 并推进通过资产状态。",
      inputSchema: {
        projectPath: z.string(),
        apply: z.boolean().default(false),
        forBuild: z.boolean().default(false),
      },
    },
    async (args) => {
      if (!args.apply) return mcpText(await service.validateProject(args.projectPath, { forBuild: args.forBuild }));
      const plan = await service.createValidationPlan(args.projectPath);
      return mcpText(await service.applyPlan(args.projectPath, plan.planId));
    },
  );

  server.registerTool(
    "imagespec_build",
    {
      title: "构建 ImageSpec 游戏资产",
      description: "按 ExportPreset 从源资产构建游戏资源、Manifest 和 Receipt。",
      inputSchema: { projectPath: z.string(), presetId: z.string() },
    },
    async (args) => {
      const plan = await service.createBuildPlan(args.projectPath, args.presetId);
      return mcpText(await service.applyPlan(args.projectPath, plan.planId));
    },
  );

  server.registerTool(
    "imagespec_export",
    {
      title: "导出 ImageSpec 游戏资产",
      description: "按 ExportPreset 生成项目内 build/ 下的导出 ZIP，并返回 Receipt。",
      inputSchema: { projectPath: z.string(), presetId: z.string(), outputPath: z.string() },
    },
    async (args) => {
      const plan = await service.createExportPlan(args.projectPath, args.presetId, args.outputPath);
      return mcpText(await service.applyPlan(args.projectPath, plan.planId));
    },
  );

  return service;
}

module.exports = {
  mcpText,
  registerImageSpecTools,
};

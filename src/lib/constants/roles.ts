// ============================================================
// 机构角色：全项目唯一定义处
//
// 角色值一旦散落成字面量（'admin' / 'leader' / 'teacher'），就会出现两种事故：
//   1. 新增角色时漏改某一处判断，导致权限判断失效
//   2. 页面文案与接口校验用不同拼写，静默走错分支
// 因此：判断用 isOrgAdmin()，展示用 orgRoleLabel()，校验用 ORG_ROLES，不要再写裸字符串。
//
// 重要：这里的 admin 是「机构管理员」，与平台顶层视角无关。
// 平台身份只认 platform_admins 白名单（见 lib/auth/platform-admin.ts）。
// ============================================================

export const ORG_ROLES = ['admin', 'leader', 'teacher'] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  admin: '机构管理员',
  leader: '教研组长',
  teacher: '普通教师',
};

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);
}

/** 用于展示；未知 / 未入机构一律给占位符，不抛错 */
export function orgRoleLabel(role: string | null | undefined): string {
  return isOrgRole(role) ? ORG_ROLE_LABEL[role] : '—';
}

/** 唯一的管理员判定；不要在页面里写 role === 'admin' */
export function isOrgAdmin(role: string | null | undefined): boolean {
  return role === 'admin';
}

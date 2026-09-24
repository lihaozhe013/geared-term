import { describe, expect, it } from 'vitest';
import { translate, type MessageKey } from './i18n';

const chineseSidebarLabels: Array<[MessageKey, string]> = [
  ['workspace', '工作区'],
  ['sidebarPanels', '侧边栏面板'],
  ['savedSessions', '已保存的会话'],
  ['wslDistributions', 'WSL 发行版'],
  ['refreshWslDistributions', '刷新 WSL 发行版'],
  ['collapseSessionsSidebar', '收起会话侧边栏'],
  ['expandSessionsSidebar', '展开会话侧边栏'],
  ['newSessionProfile', '新建会话配置'],
  ['sessions', '会话'],
  ['reorderSession', '拖动以调整会话顺序'],
  ['reorderGroup', '拖动以调整分组顺序'],
  ['newLocalSession', '新建本地会话'],
  ['newSshSession', '新建 SSH 会话'],
  ['newWslSession', '新建 WSL 会话'],
  ['emptyGroupMenuItem', '空分组'],
  ['createEmptyGroup', '新建空分组'],
  ['ungrouped', '未分组'],
  ['groupName', '分组名称'],
  ['createGroup', '创建分组'],
  ['errGroupNameRequired', '请输入分组名称'],
  ['errGroupNameExists', '已存在同名分组'],
  ['errCreateGroup', '无法创建分组'],
  ['groupActions', '分组操作'],
  ['deleteGroup', '删除分组'],
  ['sidebarEmpty', '没有已保存的会话'],
  ['sidebarEmptyHint', '使用侧边栏中的 + 按钮保存会话配置。'],
  ['noDistributionsDiscovered', '未发现 WSL 发行版。'],
  ['profileLocal', '本地'],
  ['profileSsh', 'SSH'],
  ['profileWsl', 'WSL']
];

describe('sidebar translations', () => {
  it.each(chineseSidebarLabels)('translates %s into Simplified Chinese', (key, expected) => {
    expect(translate('zh-CN', key)).toBe(expected);
  });

  it('keeps the WSL distribution hint localized around its dynamic name', () => {
    expect(translate('zh-CN', 'openWslDistributionHint').replace('{name}', 'Ubuntu'))
      .toBe('双击以在新终端中打开“Ubuntu”');
  });

  it('keeps English labels available', () => {
    expect(translate('en-US', 'newLocalSession')).toBe('New local session');
    expect(translate('en-US', 'errGroupNameExists')).toBe('A group with this name already exists');
  });
});

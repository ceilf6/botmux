import { describe, expect, it } from 'vitest';
import { buildPendingRestartNoticeCard, buildPendingRestartNoticeText } from '../src/core/pending-restart-notice.js';

describe('buildPendingRestartNoticeText', () => {
  it('auto-update: names both versions, the consequence and the restart command', () => {
    const md = buildPendingRestartNoticeText({
      reason: 'auto-update',
      oldVersion: '3.57.1',
      newVersion: '3.58.0',
      dashboardUrl: 'http://10.0.0.1:7891/?t=abc',
    });
    expect(md).toContain('v3.57.1');
    expect(md).toContain('v3.58.0');
    expect(md).toContain('botmux restart');
    expect(md).toContain('http://10.0.0.1:7891/?t=abc');
  });

  it('binary-replaced: no version line when versions are unknown, still tells how to recover', () => {
    const md = buildPendingRestartNoticeText({ reason: 'binary-replaced' });
    expect(md).not.toContain('→');
    expect(md).toContain('botmux restart');
  });

  it('includes the local direct link only when given', () => {
    const withLocal = buildPendingRestartNoticeText({
      reason: 'auto-update', oldVersion: '1.0.0', newVersion: '1.1.0',
      dashboardUrl: 'https://platform.example/d', dashboardLocalUrl: 'http://127.0.0.1:7891/?t=x',
    });
    expect(withLocal).toContain('http://127.0.0.1:7891/?t=x');
    const without = buildPendingRestartNoticeText({ reason: 'auto-update', oldVersion: '1.0.0', newVersion: '1.1.0' });
    expect(without).not.toContain('127.0.0.1');
  });

  it('renders in English when asked', () => {
    const md = buildPendingRestartNoticeText({ reason: 'auto-update', oldVersion: '1.0.0', newVersion: '1.1.0' }, 'en');
    expect(md).toContain('botmux restart');
    expect(md).not.toMatch(/[一-鿿]/);
  });
});

describe('buildPendingRestartNoticeCard', () => {
  it('is a Lark interactive card whose body is the notice text', () => {
    const input = { reason: 'auto-update' as const, oldVersion: '1.0.0', newVersion: '1.1.0' };
    const card = JSON.parse(buildPendingRestartNoticeCard(input));
    expect(card.header.title.tag).toBe('plain_text');
    expect(card.elements).toHaveLength(1);
    expect(card.elements[0].tag).toBe('markdown');
    expect(card.elements[0].content).toBe(buildPendingRestartNoticeText(input));
  });

  it('escalates the header colour when a session already failed', () => {
    const pending = JSON.parse(buildPendingRestartNoticeCard({ reason: 'auto-update' }));
    const failed = JSON.parse(buildPendingRestartNoticeCard({ reason: 'binary-replaced' }));
    expect(pending.header.template).not.toBe(failed.header.template);
  });
});

/**
 * Owner DM telling them botmux has a newer version on disk than the running
 * daemon, so a restart is needed before new sessions can start.
 *
 * Two senders share this card:
 *   · the maintenance tick, right after auto-update installed a newer version
 *     while auto-restart is off ("install only, apply on next restart");
 *   · the worker pool, when a worker exits before ready and the daemon notices
 *     its own executable has been replaced since startup (running-binary.ts) —
 *     the moment the stale daemon actually bites.
 *
 * Pure builders, unit tested; sending is wired in the daemon.
 */
import { t, type Locale } from '../i18n/index.js';

export type PendingRestartReason = 'auto-update' | 'binary-replaced';

export interface PendingRestartNoticeInput {
  reason: PendingRestartReason;
  oldVersion?: string;
  newVersion?: string;
  dashboardUrl?: string;
  dashboardLocalUrl?: string;
}

function vtag(v: string): string {
  return v.startsWith('v') ? v : `v${v}`;
}

export function buildPendingRestartNoticeText(input: PendingRestartNoticeInput, locale?: Locale): string {
  const lines: string[] = [];
  lines.push(input.reason === 'auto-update'
    ? t('pending_restart.auto_update', undefined, locale)
    : t('pending_restart.binary_replaced', undefined, locale));
  if (input.oldVersion && input.newVersion) {
    lines.push(t('restart.version_delta', { old: vtag(input.oldVersion), new: vtag(input.newVersion) }, locale));
  }
  lines.push(t('pending_restart.consequence', undefined, locale));
  lines.push(t('pending_restart.action', undefined, locale));
  if (input.dashboardUrl) lines.push(t('restart.dashboard', { url: input.dashboardUrl }, locale));
  if (input.dashboardLocalUrl) lines.push(t('restart.dashboard_local', { url: input.dashboardLocalUrl }, locale));
  return lines.join('\n');
}

/** Minimal Lark interactive card (JSON string) around the notice body. */
export function buildPendingRestartNoticeCard(input: PendingRestartNoticeInput, locale?: Locale): string {
  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      template: input.reason === 'auto-update' ? 'orange' : 'red',
      title: { tag: 'plain_text', content: t('pending_restart.card_title', undefined, locale) },
    },
    elements: [{ tag: 'markdown', content: buildPendingRestartNoticeText(input, locale) }],
  });
}

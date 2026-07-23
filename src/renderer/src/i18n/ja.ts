import type { ReiganState } from '../../../shared/types'

export const ja: Record<string, { ja: string; romaji: string }> = {
  chat:        { ja: 'チャット',    romaji: 'chatto' },
  tasks:       { ja: 'タスク',      romaji: 'tasuku' },
  files:       { ja: 'ファイル',    romaji: 'fairu' },
  mail:        { ja: 'メール',      romaji: 'meeru' },
  calendar:    { ja: 'カレンダー',  romaji: 'karendaa' },
  automations: { ja: '自動化',      romaji: 'jidouka' },
  devtools:    { ja: '開発',        romaji: 'kaihatsu' },
  settings:    { ja: '設定',        romaji: 'settei' },
  backlog:     { ja: '待機',        romaji: 'taiki' },
  active:      { ja: '進行中',      romaji: 'shinkou-chuu' },
  review:      { ja: '確認',        romaji: 'kakunin' },
  done:        { ja: '完了',        romaji: 'kanryou' },
  send:        { ja: '送信',        romaji: 'soushin' },
  cancel:      { ja: '取消',        romaji: 'torikeshi' },
  search:      { ja: '検索',        romaji: 'kensaku' },
  confirm:     { ja: '確定',        romaji: 'kakutei' },
  delete:      { ja: '削除',        romaji: 'sakujo' },
  edit:        { ja: '編集',        romaji: 'henshuu' },
  ready:       { ja: '準備完了',    romaji: 'junbi kanryou' },
  idle:        { ja: '待機',        romaji: 'taiki' },
  listening:   { ja: '聴取中',      romaji: 'choushu-chuu' },
  processing:  { ja: '処理中',      romaji: 'shori-chuu' },
  speaking:    { ja: '発話中',      romaji: 'hatsuwa-chuu' },
  error:       { ja: 'エラー',      romaji: 'eraa' },
  success:     { ja: '成功',        romaji: 'seikou' },
  spiritEye:   { ja: '心眼',        romaji: 'shingan' },
};

export const STATE_LABELS: Record<ReiganState, string> = {
  idle: ja.idle.ja,
  listening: ja.listening.ja,
  processing: ja.processing.ja,
  speaking: ja.speaking.ja,
  error: ja.error.ja,
  success: ja.success.ja,
}

/** English falls back to the state name itself; Japanese only appears once
 *  japaneseLevel >= 1 (ambient). Single source so no component redefines this. */
export function stateLabel(state: ReiganState, japaneseLevel: number): string {
  return japaneseLevel >= 1 ? STATE_LABELS[state] : state[0].toUpperCase() + state.slice(1)
}

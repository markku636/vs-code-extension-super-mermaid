// Tiny translation layer for the webviews.
//
// The extension host has `vscode.l10n`, but a webview runs in its own browser
// context with no access to it. Rather than shipping every string across in
// postMessage, each webview bundle carries the dictionaries and picks one from
// the display language the host stamps onto `<body data-locale="…">`.
//
// Source strings are English and double as the lookup keys, exactly like
// vscode.l10n — so a missing translation degrades to English instead of to a
// key name. Keep the keys here identical to the ones in l10n/bundle.l10n.ru.json
// where the same wording appears on both sides.

type Dict = Record<string, string>;

const RU: Dict = {
  // ── diagram preview (webview/main.ts) ──────────────────────────────────
  'Rendering…': 'Отрисовка…',
  'Mermaid syntax error': 'Ошибка синтаксиса Mermaid',
  'This diagram type cannot be rasterized — exported SVG instead':
    'Этот тип диаграммы нельзя растеризовать — экспортирован SVG',
  'JPEG has no transparency — background kept':
    'JPEG не поддерживает прозрачность — фон сохранён',
  'This diagram type cannot be rasterized — copied SVG markup instead':
    'Этот тип диаграммы нельзя растеризовать — скопирована разметка SVG',
  'Image copied ({0}x)': 'Изображение скопировано ({0}x)',
  'Exporting {0}/{1}…': 'Экспорт {0}/{1}…',
  'Unlock — follow active editor': 'Снять привязку — следовать за активным редактором',
  'Lock to current file': 'Привязать к текущему файлу',
  'Locked to current file': 'Привязано к текущему файлу',
  'Following the active editor': 'Следую за активным редактором',

  // ── markdown document preview (webview/markdownDocument.ts) ────────────
  Outline: 'Оглавление',
  'No headings': 'Заголовков нет',
  'No results': 'Ничего не найдено',
  Auto: 'Авто',
  Full: 'Вся ширина',
  Reading: 'Для чтения',
  'Content width: {0} — click / press w to cycle':
    'Ширина содержимого: {0} — щёлкните или нажмите w для переключения',
  '(Auto fits the window, Full = 100%, Reading = 920px)':
    '(«Авто» — по размеру окна, «Вся ширина» — 100%, «Для чтения» — 920px)',
  'Canvas 2D context unavailable.': 'Контекст Canvas 2D недоступен.',

  // ── drawing editor (webview/diagramEditor.ts) ──────────────────────────
  '⎯ no arrow': '⎯ без стрелки',
  '▸ arrow': '▸ стрелка',
  '⇁ open': '⇁ открытая',
  '● dot': '● точка',
  '✕ cross': '✕ крест',
  '▷ triangle (inheritance)': '▷ треугольник (наследование)',
  '◇ hollow diamond (aggregation)': '◇ пустой ромб (агрегация)',
  '◆ filled diamond (composition)': '◆ закрашенный ромб (композиция)',
  '⊣ one': '⊣ один',
  '⪛ many': '⪛ многие',
  '＋ more shapes…': '＋ ещё фигуры…',
  'Add a {0} node': 'Добавить узел «{0}»',
  '✓ copied': '✓ скопировано',
  '⧉ copy': '⧉ копировать',
  '✗ unsupported': '✗ не поддерживается',

  // ── node-shape captions (webview/diagramEditor.ts) ─────────────────────
  rectangle: 'прямоугольник',
  rounded: 'скруглённый',
  stadium: 'капсула',
  subroutine: 'подпроцесс',
  circle: 'круг',
  'double circle': 'двойной круг',
  diamond: 'ромб',
  hexagon: 'шестиугольник',
  flag: 'флаг',
  trapezoid: 'трапеция',
  'trapezoid (inverted)': 'трапеция (перевёрнутая)',
  parallelogram: 'параллелограмм',
  'parallelogram (left)': 'параллелограмм (влево)',
  ellipse: 'эллипс',
  state: 'состояние',
  start: 'начало',
  end: 'конец',
  'fork / join': 'ветвление / слияние',
  choice: 'выбор',
  class: 'класс',
  entity: 'сущность',
  actor: 'действующее лицо',
  participant: 'участник',
  note: 'заметка',
  requirement: 'требование',
  element: 'элемент',
  'data point': 'точка данных',
  person: 'человек',
  system: 'система',
  database: 'база данных',
  queue: 'очередь',
  card: 'карточка',
  node: 'узел',
  task: 'задача',
  slice: 'сектор',
  service: 'сервис',
  field: 'поле',
  commit: 'коммит',
  'kept as-is': 'без изменений',

  // ── keyboard-help overlay (rendered by react-super-mermaid) ────────────
  'Keyboard shortcuts': 'Клавиатурные сокращения',
  'double-click a node': 'двойной щелчок по узлу',
  'double-click empty space': 'двойной щелчок по пустому месту',
  'arrow keys': 'стрелки',
  'right-click': 'правая кнопка',
  'Select / move': 'Выделение / перемещение',
  'Connect (drag from a node)': 'Связь (потянуть от узла)',
  'Add-node tool': 'Инструмент добавления узла',
  'Edit text': 'Изменить текст',
  'Add a node there': 'Добавить узел в этом месте',
  'Add a connected node next to the selection':
    'Добавить связанный узел рядом с выделенным',
  'Delete selection': 'Удалить выделенное',
  'Undo / redo': 'Отменить / вернуть',
  'Copy / paste': 'Копировать / вставить',
  'Duplicate in place': 'Дублировать на месте',
  'Group into a subgraph': 'Сгруппировать в subgraph',
  'Select all': 'Выделить всё',
  'Nudge position': 'Сдвинуть на шаг',
  'Context menu (shape / colour / align)':
    'Контекстное меню (фигура / цвет / выравнивание)',
  'Clear selection / close': 'Снять выделение / закрыть',
  'Show / hide this help': 'Показать / скрыть эту подсказку',

  // ── context menu (rendered by react-super-mermaid) ─────────────────────
  'Add a node here': 'Добавить узел здесь',
  Paste: 'Вставить',
  'Tidy layout': 'Упорядочить',
  Rename: 'Переименовать',
  Duplicate: 'Дублировать',
  Delete: 'Удалить',
  'Fill colour': 'Заливка',
  'Add child node': 'Добавить дочерний узел',
  'Promote one level up': 'Поднять на уровень выше',
  Ungroup: 'Разгруппировать',
  'Group into subgraph': 'Сгруппировать в subgraph',
  'Align left': 'Выровнять по левому краю',
  'Center horizontally': 'Центрировать по горизонтали',
  'Align right': 'Выровнять по правому краю',
  'Align top': 'Выровнять по верхнему краю',
  'Center vertically': 'Центрировать по вертикали',
  'Align bottom': 'Выровнять по нижнему краю',
  'Distribute horizontally': 'Распределить по горизонтали',
  'Distribute vertically': 'Распределить по вертикали',
  'Solid line': 'Сплошная линия',
  'Dashed line': 'Пунктирная линия',
  'Thick line': 'Толстая линия',
  'Toggle arrow': 'Показать / убрать стрелку',
  'Toggle solid / dashed arrow': 'Сплошная / пунктирная стрелка',
  'Delete note': 'Удалить заметку',
  'Delete message': 'Удалить сообщение',
  'Delete participant': 'Удалить участника',
  'Add participant': 'Добавить участника',
  'Add message': 'Добавить сообщение',
  'Add note': 'Добавить заметку',
  'Change commit id': 'Изменить id коммита',
  'Add tag': 'Добавить метку',
  'Change tag': 'Изменить метку',
  'Remove tag': 'Убрать метку',
  'Delete this commit': 'Удалить этот коммит',
  'Rename branch': 'Переименовать ветку',
  'Delete this branch': 'Удалить эту ветку',
  'Add branch': 'Добавить ветку',
  'Add commit': 'Добавить коммит',
  'Rename section': 'Переименовать section',
  'Delete this section': 'Удалить этот section',
  'Add section': 'Добавить section',
  'Rename column': 'Переименовать колонку',
  'Delete this column': 'Удалить эту колонку',
  'Add column': 'Добавить колонку',
  'Add task': 'Добавить задачу',
  'Add card': 'Добавить карточку',
  'Normal commit': 'Обычный коммит',
  'Highlight commit (filled)': 'Важный коммит (закрашенный)',
  'Reverse commit (crossed)': 'Откат (перечёркнутый)',
  'contains (contains)': 'contains (содержит)',
  'copies (copies)': 'copies (копирует)',
  'derives (derives)': 'derives (производное)',
  'satisfies (satisfies)': 'satisfies (удовлетворяет)',
  'verifies (verifies)': 'verifies (проверяет)',
  'refines (refines)': 'refines (уточняет)',
  'traces (traces)': 'traces (прослеживает)',
};

/**
 * zh-TW → English for the strings react-super-mermaid renders itself.
 *
 * The library's help overlay and context menu are hard-coded zh-TW with no
 * hook to override them, so the editor translates their DOM after the fact
 * (see localizeLibDom in diagramEditor.ts). Mapping to English first means a
 * locale without a dictionary still gets English instead of zh-TW.
 */
const LIB_ZH_EN: Dict = {
  // help overlay
  鍵盤快捷鍵: 'Keyboard shortcuts',
  雙擊節點: 'double-click a node',
  雙擊空白: 'double-click empty space',
  方向鍵: 'arrow keys',
  右鍵: 'right-click',
  '選取 / 移動': 'Select / move',
  '連線(從節點拉線)': 'Connect (drag from a node)',
  新增節點工具: 'Add-node tool',
  編輯文字: 'Edit text',
  在該處新增節點: 'Add a node there',
  在選取節點旁新增相連節點: 'Add a connected node next to the selection',
  刪除選取: 'Delete selection',
  '復原 / 重做': 'Undo / redo',
  '複製 / 貼上': 'Copy / paste',
  原地複製: 'Duplicate in place',
  '群組 subgraph': 'Group into a subgraph',
  全選: 'Select all',
  微調位置: 'Nudge position',
  '情境選單(外形 / 顏色 / 對齊)': 'Context menu (shape / colour / align)',
  '取消選取 / 關閉': 'Clear selection / close',
  '顯示 / 隱藏此說明': 'Show / hide this help',

  // context menu
  在此新增節點: 'Add a node here',
  貼上: 'Paste',
  整理排版: 'Tidy layout',
  改名: 'Rename',
  複製: 'Duplicate',
  刪除: 'Delete',
  上色: 'Fill colour',
  新增子節點: 'Add child node',
  升為上一層: 'Promote one level up',
  解除群組: 'Ungroup',
  '群組成 subgraph': 'Group into subgraph',
  靠左對齊: 'Align left',
  水平置中: 'Center horizontally',
  靠右對齊: 'Align right',
  靠上對齊: 'Align top',
  垂直置中: 'Center vertically',
  靠下對齊: 'Align bottom',
  水平均分: 'Distribute horizontally',
  垂直均分: 'Distribute vertically',
  實線: 'Solid line',
  虛線: 'Dashed line',
  粗線: 'Thick line',
  切換箭頭: 'Toggle arrow',
  '切換實/虛箭頭': 'Toggle solid / dashed arrow',
  刪除筆記: 'Delete note',
  刪除訊息: 'Delete message',
  刪除參與者: 'Delete participant',
  新增參與者: 'Add participant',
  新增訊息: 'Add message',
  新增筆記: 'Add note',
  '改提交 id': 'Change commit id',
  加標籤: 'Add tag',
  改標籤: 'Change tag',
  移除標籤: 'Remove tag',
  刪除這個提交: 'Delete this commit',
  改分支名稱: 'Rename branch',
  刪除這條分支: 'Delete this branch',
  新增分支: 'Add branch',
  新增提交: 'Add commit',
  '改 section 名稱': 'Rename section',
  '刪除這個 section': 'Delete this section',
  '新增 section': 'Add section',
  改欄位名稱: 'Rename column',
  刪除這一欄: 'Delete this column',
  新增欄位: 'Add column',
  新增任務: 'Add task',
  新增卡片: 'Add card',

  // gitgraph commit types (context menu, prefixed with ● / 　)
  一般提交: 'Normal commit',
  '重點提交(實心)': 'Highlight commit (filled)',
  '回退提交(打叉)': 'Reverse commit (crossed)',

  // requirement relations (context menu, prefixed with ● / 　)
  'contains(包含)': 'contains (contains)',
  'copies(複製)': 'copies (copies)',
  'derives(衍生)': 'derives (derives)',
  'satisfies(滿足)': 'satisfies (satisfies)',
  'verifies(驗證)': 'verifies (verifies)',
  'refines(細化)': 'refines (refines)',
  'traces(追溯)': 'traces (traces)',

  // node-shape captions, shown as the tooltip of the context menu shape strip
  方框: 'rectangle',
  圓角: 'rounded',
  膠囊: 'stadium',
  子流程: 'subroutine',
  資料庫: 'database',
  圓形: 'circle',
  雙圈: 'double circle',
  菱形: 'diamond',
  六角: 'hexagon',
  旗標: 'flag',
  梯形: 'trapezoid',
  '梯形(倒)': 'trapezoid (inverted)',
  平行四邊形: 'parallelogram',
  '平行四邊形(左)': 'parallelogram (left)',
  橢圓: 'ellipse',
  狀態: 'state',
  起始: 'start',
  結束: 'end',
  '分岔/匯合': 'fork / join',
  選擇: 'choice',
  類別: 'class',
  實體: 'entity',
  角色: 'actor',
  參與者: 'participant',
  筆記: 'note',
  需求: 'requirement',
  元素: 'element',
  資料點: 'data point',
  人員: 'person',
  系統: 'system',
  佇列: 'queue',
  卡片: 'card',
  節點: 'node',
  任務: 'task',
  扇形: 'slice',
  服務: 'service',
  欄位: 'field',
  提交: 'commit',
  原樣保留: 'kept as-is',
};

/**
 * Traditional Chinese — the extension's own strings.
 *
 * Everything the library renders itself is NOT listed here: those come from
 * LIB_ZH_EN read backwards (see ZH_TW below), so the help overlay and the
 * context menu keep the exact wording upstream ships, down to the punctuation.
 * Strings that existed in the pre-i18n zh-TW code are copied from it verbatim.
 */
const ZH_TW_OWN: Dict = {
  // ── diagram preview (webview/main.ts) ──────────────────────────────────
  'Rendering…': '繪製中…',
  'Mermaid syntax error': 'Mermaid 語法錯誤',
  'This diagram type cannot be rasterized — exported SVG instead':
    '此圖種無法轉成點陣圖 —— 已改匯出 SVG',
  'JPEG has no transparency — background kept': 'JPEG 不支援透明 —— 已保留背景',
  'This diagram type cannot be rasterized — copied SVG markup instead':
    '此圖種無法轉成點陣圖 —— 已改複製 SVG 原始碼',
  'Image copied ({0}x)': '已複製圖片({0}x)',
  'Exporting {0}/{1}…': '匯出中 {0}/{1}…',
  'Unlock — follow active editor': '解除鎖定 —— 跟隨作用中的編輯器',
  'Lock to current file': '鎖定到目前檔案',
  'Locked to current file': '已鎖定到目前檔案',
  'Following the active editor': '正在跟隨作用中的編輯器',

  // ── markdown document preview (webview/markdownDocument.ts) ────────────
  Outline: '大綱',
  'No headings': '沒有標題',
  'No results': '沒有相符結果',
  Auto: '自動',
  Full: '滿版',
  Reading: '閱讀',
  'Content width: {0} — click / press w to cycle': '內容寬度:{0} —— 點擊或按 w 循環切換',
  '(Auto fits the window, Full = 100%, Reading = 920px)':
    '(「自動」符合視窗、「滿版」= 100%、「閱讀」= 920px)',
  'Canvas 2D context unavailable.': '無法取得 Canvas 2D 繪圖環境。',

  // ── drawing editor (webview/diagramEditor.ts) ──────────────────────────
  '⎯ no arrow': '⎯ 無箭頭',
  '▸ arrow': '▸ 箭頭',
  '⇁ open': '⇁ 開放',
  '● dot': '● 圓點',
  '✕ cross': '✕ 交叉',
  '▷ triangle (inheritance)': '▷ 三角(繼承)',
  '◇ hollow diamond (aggregation)': '◇ 空心菱(聚合)',
  '◆ filled diamond (composition)': '◆ 實心菱(組合)',
  '⊣ one': '⊣ 一',
  '⪛ many': '⪛ 多',
  '＋ more shapes…': '＋ 更多外形…',
  'Add a {0} node': '新增{0}節點',
  '✓ copied': '✓ 已複製',
  '⧉ copy': '⧉ 複製',
  '✗ unsupported': '✗ 不支援',
};

/** LIB_ZH_EN read backwards: English key → the zh-TW the library itself prints. */
function libZhTw(): Dict {
  const out: Dict = {};
  for (const [zh, en] of Object.entries(LIB_ZH_EN)) {
    out[en] = zh;
  }
  return out;
}

const ZH_TW: Dict = { ...libZhTw(), ...ZH_TW_OWN };

// Keys are VS Code display-language tags, lower-cased. Simplified Chinese
// ("zh-cn") is deliberately absent: these are Traditional forms, and English is
// a better answer for a 简体 reader than 繁體 would be.
const DICTS: Record<string, Dict> = { ru: RU, 'zh-tw': ZH_TW };

let dict: Dict = {};

/** Pick the dictionary for a VS Code display language (e.g. "ru", "pt-br"). */
export function initI18n(locale: string | undefined | null): void {
  const tag = (locale ?? 'en').toLowerCase();
  dict = DICTS[tag] ?? DICTS[tag.split('-')[0]] ?? {};
}

/** Read the locale the host stamped on <body data-locale="…"> and load it. */
export function initI18nFromDocument(): void {
  initI18n(document.body?.dataset.locale);
}

/**
 * Translate one zh-TW string baked into react-super-mermaid.
 *
 * Menu entries that mark the current choice come prefixed with "● " or the
 * ideographic space "　", so the marker is stripped before the lookup and put
 * back afterwards. An unknown string is returned untouched.
 */
export function tLib(text: string): string {
  const marker = /^(●\s|　)/.exec(text)?.[0] ?? '';
  const body = text.slice(marker.length);
  const english = LIB_ZH_EN[body];
  return english === undefined ? text : marker + t(english);
}

/** Translate `message`, substituting {0}, {1}, … with `args`. */
export function t(message: string, ...args: Array<string | number>): string {
  const text = dict[message] ?? message;
  if (args.length === 0) {
    return text;
  }
  return text.replace(/\{(\d+)\}/g, (whole, i) => {
    const value = args[Number(i)];
    return value === undefined ? whole : String(value);
  });
}

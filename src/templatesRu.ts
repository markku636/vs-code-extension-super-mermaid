// Russian variants of the diagram template bodies (see src/templates.ts).
//
// Kept in a separate, vscode-free module so both the runtime (insertTemplate)
// and the build-time snippet generator can read them. Keyed by template id;
// a template with no entry here falls back to its English body.
//
// Only the parts a reader sees are translated. Code-shaped identifiers stay
// Latin on purpose: mermaid's grammar is picky about non-ASCII in some
// positions (requirement names, sankey nodes), and a class/ER diagram of real
// code is more useful with the real identifiers in it. Every body here is
// checked with `node scripts/checkSyntax.mjs` before it lands.

export const RU_BODIES: Record<string, string> = {
  'flowchart-basic': `flowchart TD
    A([\${1:Начало}]) --> B{\${2:Данные корректны?}}
    B -- Да --> C[\${3:Обработать данные}]
    B -- Нет --> D[\${4:Показать ошибку}]
    C --> E([Конец])
    D --> E$0`,

  'flowchart-subgraph': `flowchart LR
    subgraph client [Клиент]
        A[Браузер] --> B[\${1:SPA}]
    end
    subgraph server [Сервер]
        C[API-шлюз] --> D[\${2:Сервис}]
        D --> E[(База данных)]
    end
    B -->|HTTPS| C$0`,

  'sequence-alt': `sequenceDiagram
    autonumber
    actor U as \${1:Пользователь}
    participant S as \${2:Сервер}
    participant DB as База данных
    U->>S: Запрос на вход
    S->>DB: Найти пользователя
    DB-->>S: Запись пользователя
    alt данные верны
        S-->>U: 200 OK и токен
    else данные неверны
        S-->>U: 401 Unauthorized
    end$0`,

  'state-v2': `stateDiagram-v2
    [*] --> Idle
    Idle : Простой
    \${1:Running} : Работает
    Paused : Пауза
    Idle --> \${1:Running} : старт
    \${1:Running} --> Paused : пауза
    Paused --> \${1:Running} : продолжить
    \${1:Running} --> [*] : стоп$0`,

  'class-basic': `classDiagram
    class \${1:Животное} {
        +String имя
        +int возраст
        +издатьЗвук() void
    }
    class \${2:Собака} {
        +принести() void
    }
    class Кошка {
        -bool домашняя
    }
    \${1:Животное} <|-- \${2:Собака}
    \${1:Животное} <|-- Кошка$0`,

  'er-basic': `erDiagram
    \${1:КЛИЕНТ} ||--o{ \${2:ЗАКАЗ} : "оформляет"
    \${2:ЗАКАЗ} ||--|{ ПОЗИЦИЯ_ЗАКАЗА : "содержит"
    ТОВАР ||--o{ ПОЗИЦИЯ_ЗАКАЗА : "входит в"
    \${1:КЛИЕНТ} {
        int id PK
        string имя
        string email
    }
    \${2:ЗАКАЗ} {
        int id PK
        date создан
    }$0`,

  'pie-basic': `pie title \${1:Доли браузеров}
    "Chrome" : 62
    "Safari" : 20
    "Edge" : 10
    "Прочие" : 8$0`,

  quadrant: `quadrantChart
    title \${1:Охват и вовлечённость}
    x-axis Низкий охват --> Высокий охват
    y-axis Низкая вовлечённость --> Высокая вовлечённость
    quadrant-1 Расширять
    quadrant-2 Продвигать
    quadrant-3 Пересмотреть
    quadrant-4 Улучшать
    Кампания А: [0.3, 0.6]
    Кампания Б: [0.45, 0.23]
    Кампания В: [0.78, 0.34]$0`,

  // Axis categories and the title must be quoted here — xychart's lexer rejects
  // bare non-ASCII words.
  xychart: `xychart-beta
    title "\${1:Выручка от продаж}"
    x-axis ["Янв", "Фев", "Мар", "Апр", "Май", "Июн"]
    y-axis "Выручка, тыс." 0 --> 100
    bar [25, 48, 38, 60, 72, 85]
    line [20, 40, 45, 55, 70, 90]$0`,

  'gantt-basic': `gantt
    title \${1:План проекта}
    dateFormat YYYY-MM-DD
    section Проектирование
        Требования :done, a1, \${2:2026-06-01}, 5d
        Макеты     :active, a2, after a1, 7d
    section Разработка
        Реализация :b1, after a2, 14d
        Тестирование :b2, after b1, 7d$0`,

  timeline: `timeline
    title \${1:История продукта}
    section 2024
        3 кв. : Прототип
        4 кв. : Закрытая бета
    section 2025
        1 кв. : Публичный запуск
        3 кв. : Мобильное приложение
    section 2026
        1 кв. : Корпоративный тариф$0`,

  journey: `journey
    title \${1:Оформление заказа}
    section Выбор
        Поиск товаров: 5: Покупатель
        Сравнение вариантов: 3: Покупатель
    section Покупка
        Добавить в корзину: 4: Покупатель
        Оплата: 2: Покупатель, Поддержка
    section После покупки
        Отслеживание доставки: 4: Покупатель$0`,

  kanban: `kanban
    Надо сделать
        [\${1:Нарисовать страницу входа}]
        [Описать API]
    В работе
        [Реализовать авторизацию]
    Готово
        [Развернуть проект]$0`,

  mindmap: `mindmap
  root((\${1:Проект}))
    Цели
      Выпустить MVP
      Нарастить аудиторию
    Риски
      Расползание объёма
      Сроки
    Команда
      Бэкенд
      Фронтенд$0`,

  'c4-context': `C4Context
    title \${1:Системный контекст}
    Person(user, "Пользователь", "Клиент платформы")
    System(app, "\${2:Веб-приложение}", "Основные возможности")
    System_Ext(mail, "Почтовый сервис", "Отправляет уведомления")
    Rel(user, app, "Использует")
    Rel(app, mail, "Отправляет письма через")$0`,

  // Group / service labels must be quoted — architecture-beta's lexer rejects
  // bare non-ASCII inside [...].
  architecture: `architecture-beta
    group cloud(cloud)["\${1:Облако}"]
    service api(server)["API"] in cloud
    service db(database)["База данных"] in cloud
    service disk(disk)["Хранилище"] in cloud
    api:R --> L:db
    db:R --> L:disk$0`,

  block: `block-beta
    columns 3
    front["Фронтенд"] blockArrowId<["API"]>(right) back["Бэкенд"]
    space down1<[" "]>(down) space
    cache["\${1:Кэш}"] space db[("База данных")]$0`,

  packet: `packet-beta
    0-15: "Порт источника"
    16-31: "Порт получателя"
    32-63: "Номер последовательности"
    64-95: "Номер подтверждения"$0`,

  // Branch names stay Latin: they are real git refs, not display text.
  gitgraph: `gitGraph
    commit id: "старт"
    branch \${1:feature}
    checkout \${1:feature}
    commit id: "работа"
    commit id: "ещё работа"
    checkout main
    merge \${1:feature} tag: "v1.0"
    commit id: "хотфикс"$0`,

  // Requirement / element names stay Latin (the grammar rejects non-ASCII
  // there); `text:` has to be quoted for the same reason.
  requirement: `requirementDiagram
    requirement \${1:login_req} {
        id: 1
        text: "Пользователь должен иметь возможность войти."
        risk: medium
        verifymethod: test
    }
    element auth_service {
        type: service
    }
    auth_service - satisfies -> \${1:login_req}$0`,

  'orid-retro': `orid
    title \${1:Разбор после релиза}
    objective
        \${2:Доля ошибок после релиза 3,2%}
        Средняя задержка 850 мс
    reflective
        \${3:Команда напряжена}
        Жалоб от пользователей стало больше
    interpretive
        \${4:Корневая причина — пробел в мониторинге}
    decisional
        \${5:Добавить алерты @owner 25.08}
        Добавить нагрузочные тесты @owner 01.09$0`,

  'orid-blank': `orid
    title \${1:Тема обсуждения}
    objective
        \${2:Что увидели и услышали? Только проверяемые факты}
    reflective
        \${3:Что почувствовали, первая реакция}
    interpretive
        \${4:Что это значит? Корневые причины и выводы}
    decisional
        \${5:Что делаем дальше? Кто отвечает и к какому сроку}$0`,
};

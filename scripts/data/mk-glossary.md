# Macedonian (`mk`) glossary — Elyon CRM

**Binding term list for `src/i18n/locales/mk.json`.** Every translator and
reviewer must follow it exactly. Consistency beats elegance: the same English
word gets the same Macedonian word on every screen.

## Register

Terse call-centre Macedonian, literary standard (Скопје). Imperative for buttons
(`Зачувај`, not `Зачувување`). Short — an agent reads these mid-call. Match the
length of the English/Bulgarian source; never pad.

## Orthography — the hard rules

Macedonian **does not have** these Bulgarian letters. If any appears in
`mk.json`, it is a bug:

- **`ъ`** — never. (BG `Поръчка` → MK `Нарачка`)
- **`щ`** — never; Macedonian writes **`шт`**. (BG `Още` → MK `Уште`)
- **`я`, `ю`, `ь`** — never.

Macedonian **uses** `ѓ ќ љ њ џ ѕ`. Definite article `-от / -та / -то / -те`.

## Core CRM nouns

| EN | ✅ MK — use this | ❌ BG — never copy |
|---|---|---|
| Order | Нарачка | Поръчка |
| Orders | Нарачки | Поръчки |
| Customer / client | Клиент | Клиент |
| Product | Производ | Продукт |
| Package | Пакет | Пакет |
| Shipment / parcel | Пратка | Пратка |
| Delivery / shipping | Испорака | Доставка |
| Courier | Курир | Куриер |
| Warehouse | Магацин | Склад |
| Stock / inventory | Залиха | Наличност |
| Price | Цена | Цена |
| Amount / sum | Износ | Сума |
| Total | Вкупно | Общо |
| Quantity | Количина | Количество |
| Revenue | Приход | Приход |
| Profit | Добивка | Печалба |
| Commission | Провизија | Комисиона |
| Bonus | Бонус | Бонус |
| Payout | Исплата | Изплащане |
| Call (noun) | Повик | Обаждане |
| Missed call | Пропуштен повик | Пропуснато обаждане |
| Recording | Снимка | Запис |
| Agent | Агент | Агент |
| Manager | Менаџер | Мениджър |
| Administrator | Администратор | Администратор |
| User | Корисник | Потребител |
| Role | Улога | Роля |
| Permission | Дозвола | Право / Разрешение |
| Shift | Смена | Смяна |
| Break | Пауза | Почивка |
| Settings | Поставки | Настройки |
| Notification | Известување | Известие |
| Report | Извештај | Отчет / Справка |
| Note | Белешка | Бележка |
| File | Датотека | Файл |
| Address | Адреса | Адрес |
| Office (courier) | Офис | Офис |
| Lead | Лид | Лийд |
| Segment | Сегмент | Сегмент |
| History | Историја | История |
| Details | Детали | Детайли |
| Password | Лозинка | Парола |
| Login (noun) | Најава | Вход |
| Logout | Одјава | Изход |
| Week | Седмица | Седмица |
| Sunday | Недела | Неделя |
| Today | Денес | Днес |
| Yesterday | Вчера | Вчера |

> ⚠️ `Недела` in Macedonian means **Sunday**. Always use **`Седмица`** for *week*.

## Verbs / buttons (imperative)

| EN | ✅ MK | ❌ BG |
|---|---|---|
| Save | Зачувај | Запази |
| Save changes | Зачувај промени | Запази промените |
| Add | Додај | Добави |
| Edit | Уреди | Редактирай |
| Delete | Избриши | Изтрий |
| Cancel (dismiss) | Откажи | Откажи / Отказ |
| Confirm | Потврди | Потвърди |
| Search | Пребарај | Търси |
| Filter | Филтрирај | Филтрирай |
| Select / choose | Избери | Избери |
| Assign | Додели | Разпредели |
| Unassign | Одземи | Премахни |
| Export | Извези | Експортирай |
| Import | Увези | Импортирай |
| Download | Преземи | Изтегли |
| Upload / attach | Прикачи | Качи |
| Print | Печати | Отпечатай |
| Copy | Копирај | Копирай |
| Refresh | Освежи | Обнови |
| Update | Ажурирај | Обнови |
| Create | Креирај | Създай |
| Open | Отвори | Отвори |
| Close | Затвори | Затвори |
| Back | Назад | Назад |
| Next | Следно | Напред |
| Retry / try again | Обиди се повторно | Опитай отново |
| Clear | Исчисти | Изчисти |
| Call (verb) | Јави се | Обади се |
| Call again | Јави се повторно | Обади се пак |
| Loading… | Се вчитува… | Зареждане… |

## Order statuses (`status.*` — labels only, never the enum values)

| enum | ✅ MK | ❌ BG |
|---|---|---|
| pending | На чекање | Чакаща |
| confirmed | Потврдена | Потвърдена |
| shipped | Испратена | Изпратена |
| delivered | Испорачана | Доставена |
| paid | Платена | Платена |
| cancelled | Откажана | Отказана |
| returned | Вратена | Върната |
| rejected | Одбиена | Отказана |
| duplicated | Дупликат | Дублирана |

## Feedback words

| EN | ✅ MK | ❌ BG |
|---|---|---|
| Success / Saved | Успешно / Зачувано | Успешно / Запазено |
| Error | Грешка | Грешка |
| Failed | Неуспешно | Неуспешно |
| Required | Задолжително | Задължително |
| Optional | По избор | По избор |
| All | Сите | Всички |
| None | Ниту еден | Никой |
| Yes / No | Да / Не | Да / Не |
| No results | Нема резултати | Няма резултати |

## Never translate

Brand and courier names, exactly as written: **Speedy, Econt, BigArena,
naturatherapy.mk, Elyon CRM, Pure Profit, Monadon, AlterCPA, Discord, Vercel,
Supabase**. Enum *values* in payloads/URLs (`pending`, `not_satisfied`, …) —
labels only. Currency symbols `€` / `лв`. Anything inside `{{…}}`.

## The `languages.*` key

`languages.mk` = **`Македонски`** in all four locale files (a language's own
name is written in that language everywhere — `English`, `Български`, `Shqip`,
`Македонски`).

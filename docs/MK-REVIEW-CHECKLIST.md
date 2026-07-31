# Macedonian (MK) — operator spot-check sheet

Generated 2026-07-22. These are the strings an agent reads every shift, so they
are the ones worth eyeballing first. Read the **МК** column; if a word is wrong,
tell me the key and the word you want — the keys stay stable, only values change.

Everything here is also live in the app: switch the top-bar flag to
**Македонски** and walk Calls → Orders → Dashboard.

Full file: `src/i18n/locales/mk.json` (2,744 keys).
Binding term list: `scripts/data/mk-glossary.md`.


## Navigation (sidebar)

| key | EN | BG | МК |
|---|---|---|---|
| `nav.affiliateDashboard` | My Dashboard | Моето табло | **Моја табла** |
| `nav.affiliateIntegration` | Integration | Интеграция | **Интеграција** |
| `nav.affiliateOffers` | My Offers | Моите оферти | **Мои понуди** |
| `nav.affiliates` | Affiliates | Афилиати | **Афилијати** |
| `nav.assignedToMe` | Assigned to Me | Възложени на мен | **Доделени на мене** |
| `nav.assigner` | Assigner | Разпределител | **Распределувач** |
| `nav.callAgain` | Call Again | Повторни обаждания | **Повторни повици** |
| `nav.callHistory` | Call History | История на обажданията | **Историја на повици** |
| `nav.callSupportCenter` | Call Support Center | Помощен център | **Центар за поддршка** |
| `nav.calls` | Calls | Обаждания | **Повици** |
| `nav.dashboard` | Dashboard | Табло | **Табла** |
| `nav.inboundLeads` | Inbound Leads | Входящи лийдове | **Дојдовни лидови** |
| `nav.insights` | Insights | Отчети | **Извештаи** |
| `nav.leadDistribution` | Lead Distribution | Разпределение на лийдове | **Распределба на лидови** |
| `nav.missedCalls` | Missed Calls | Пропуснати обаждания | **Пропуштени повици** |
| `nav.myShifts` | My Shifts | Моите смени | **Мои смени** |
| `nav.operations` | Operations | Операции | **Операции** |
| `nav.orders` | Orders | Поръчки | **Нарачки** |
| `nav.personalList` | Personal List | Личен списък | **Личен список** |
| `nav.predictionLeads` | Prediction Leads | Прогнозни лийдове | **Прогнозни лидови** |
| `nav.predictionLists` | Prediction Lists | Прогнозни списъци | **Прогнозни списоци** |
| `nav.products` | Products | Продукти | **Производи** |
| `nav.searchPrediction` | Search Prediction | Търсене в прогнози | **Пребарување во прогнози** |
| `nav.sections.analytics` | Analytics | Анализи | **Аналитика** |
| `nav.sections.productsAds` | Products & Ads | Продукти и реклами | **Производи и реклами** |
| `nav.sections.sales` | Sales | Продажби | **Продажби** |
| `nav.sections.team` | Team | Екип | **Тим** |
| `nav.sections.warehouse` | Warehouse | Склад | **Магацин** |
| `nav.settings` | Settings | Настройки | **Поставки** |
| `nav.shiftsManagement` | Shifts Management | Управление на смени | **Управување со смени** |

_(+5 more keys in this domain)_

## Order statuses

| key | EN | BG | МК |
|---|---|---|---|
| `status.call_again` | Call Again | Повторно обаждане | **Повторен повик** |
| `status.cancelled` | Cancelled | Отказана | **Откажана** |
| `status.confirmed` | Confirmed | Потвърдена | **Потврдена** |
| `status.delivered` | Delivered | Доставена | **Испорачана** |
| `status.duplicated` | Duplicated | Дублирана | **Дупликат** |
| `status.paid` | Paid | Платена | **Платена** |
| `status.pending` | Pending | Чакаща | **На чекање** |
| `status.returned` | Returned | Върната | **Вратена** |
| `status.shipped` | Shipped | Изпратена | **Испратена** |
| `status.take` | Take | Взета | **Земена** |
| `status.trashed` | Trashed | В коша | **Во корпа** |

## Common buttons & words

| key | EN | BG | МК |
|---|---|---|---|
| `common.actions` | Actions | Действия | **Дејства** |
| `common.all` | All | Всички | **Сите** |
| `common.cancel` | Cancel | Отказ | **Откажи** |
| `common.clear` | Clear | Изчисти | **Исчисти** |
| `common.close` | Close | Затвори | **Затвори** |
| `common.collapse` | Collapse | Свий | **Собери** |
| `common.confirm` | Confirm | Потвърди | **Потврди** |
| `common.create` | Create | Създай | **Креирај** |
| `common.createOrder` | Create Order | Създай поръчка | **Креирај нарачка** |
| `common.delete` | Delete | Изтрий | **Избриши** |
| `common.dismiss` | Dismiss | Скрий | **Отфрли** |
| `common.edit` | Edit | Редактирай | **Уреди** |
| `common.error` | Error | Грешка | **Грешка** |
| `common.expand` | Expand | Разгъни | **Прошири** |
| `common.export` | Export | Експорт | **Извези** |
| `common.language` | Language | Език | **Јазик** |
| `common.loading` | Loading… | Зареждане… | **Се вчитува…** |
| `common.moreRanges` | More ranges | Още периоди | **Уште периоди** |
| `common.no` | No | Не | **Не** |
| `common.optional` | Optional | По избор | **По избор** |
| `common.retry` | Retry | Опитай пак | **Обиди се повторно** |
| `common.save` | Save | Запази | **Зачувај** |
| `common.saved` | Saved | Запазено | **Зачувано** |
| `common.saving` | Saving… | Запазване… | **Се зачувува…** |
| `common.search` | Search | Търсене | **Пребарај** |
| `common.signOut` | Sign out | Изход | **Одјави се** |
| `common.toggleTheme` | Toggle theme | Превключи темата | **Смени тема** |
| `common.unknown` | Unknown | Неизвестно | **Непознато** |
| `common.unknownError` | Unknown error | Неизвестна грешка | **Непозната грешка** |
| `common.user` | User | Потребител | **Корисник** |

_(+1 more keys in this domain)_

## Languages (switcher)

| key | EN | BG | МК |
|---|---|---|---|
| `languages.bg` | Български | Български | **Български** |
| `languages.en` | English | English | **English** |
| `languages.mk` | Македонски | Македонски | **Македонски** |
| `languages.sq` | Shqip | Shqip | **Shqip** |

## Page titles

| key | EN | BG | МК |
|---|---|---|---|
| `titles.accessDenied` | Access denied | Достъп отказан | **Забранет пристап** |
| `titles.leadDistributionEngine` | Lead Distribution Engine | Разпределение на лийдове | **Распределба на лидови** |
| `titles.myPerformance` | My Performance | Моето представяне | **Мојот учинок** |
| `titles.operationsCenter` | Operations Center | Операционен център | **Оперативен центар** |
| `titles.predictionList` | Prediction List | Прогнозен списък | **Прогнозен список** |

## Roles

| key | EN | BG | МК |
|---|---|---|---|
| `roles.adsAdmin` | Ads Admin | Админ реклами | **Админ за реклами** |
| `roles.affiliate` | Affiliate | Афилиат | **Афилијат** |
| `roles.callAgent` | Call Agent | Агент | **Агент за повици** |
| `roles.manager` | Manager | Мениджър | **Менаџер** |
| `roles.superadmin` | Superadmin | Суперадмин | **Суперадмин** |
| `roles.warehouse` | Warehouse | Склад | **Магацин** |
| `userRole.admin` | Admin | Админ | **Админ** |
| `userRole.ads_admin` | Ads Admin | Админ реклами | **Админ за реклами** |
| `userRole.agent` | Agent | Агент | **Агент** |
| `userRole.inbound_agent` | Inbound Agent | Входящ агент | **Дојдовен агент** |
| `userRole.manager` | Manager | Мениджър | **Менаџер** |
| `userRole.pending_agent` | Pending Agent | Чакащ агент | **Агент на чекање** |
| `userRole.prediction_agent` | Prediction Agent | Прогнозен агент | **Прогнозен агент** |
| `userRole.warehouse` | Warehouse | Склад | **Магацин** |

## Call outcome / answer picker

| key | EN | BG | МК |
|---|---|---|---|
| `chooseAnswer.button` | Choose Answer | Избери резултат | **Избери резултат** |
| `chooseAnswer.callAgainDesc` | No pickup. The customer goes back to Call Again and resurfaces in the queue today. | Без вдигане. Клиентът се връща в Повторни обаждания и пак излиза в опашката днес. | **Не се јави. Клиентот се враќа во Повторно јавување и денес пак излегува во редицата.** |
| `chooseAnswer.confirmedDesc` | The customer agreed. Open the order form to confirm products, address and delivery. | Клиентът се съгласи. Отвори формата за поръчка, за да потвърдиш продукти, адрес и доставка. | **Клиентот се согласи. Отвори ја формата за нарачка за да ги потврдиш производите, адресата и испораката.** |
| `chooseAnswer.createOrder` | Create order | Създай поръчка | **Креирај нарачка** |
| `chooseAnswer.dialogTitle` | What happened on the call? | Какво се случи по обаждането? | **Што се случи на повикот?** |
| `chooseAnswer.moveToCallAgain` | Move to Call Again | Премести в Повторни обаждания | **Премести во Повторно јавување** |
| `chooseAnswer.optionalNote` | Optional note… | Бележка (по избор)… | **Белешка (по избор)…** |
| `chooseAnswer.otherRequiredPlaceholder` | Please type the reason… | Опишете причината… | **Напишете ја причината…** |
| `chooseAnswer.outcomeCallAgain` | Didn't Answer | Не отговори | **Не одговори** |
| `chooseAnswer.outcomeCallAgainHint` | call again | обади се пак | **јави се повторно** |
| `chooseAnswer.outcomeCancel` | Cancel | Отказ | **Откажана** |
| `chooseAnswer.outcomeCancelHint` | pick reason | избери причина | **избери причина** |
| `chooseAnswer.outcomeConfirmed` | Confirmed | Потвърдена | **Потврдена** |
| `chooseAnswer.outcomeConfirmedHint` | create order | създай поръчка | **креирај нарачка** |
| `chooseAnswer.outcomeTrash` | Trash | В коша | **Отфрлена** |
| `chooseAnswer.outcomeTrashHint` | wrong number / rude | грешен номер / грубост | **погрешен број / грубост** |
| `chooseAnswer.pickOutcomeHint` | Pick an outcome on the left. | Избери резултат отляво. | **Избери резултат лево.** |
| `chooseAnswer.saveCancellation` | Save cancellation | Запази отказа | **Зачувај го откажувањето** |
| `chooseAnswer.saveTrash` | Save trash | Запази в коша | **Зачувај отфрлање** |
| `chooseAnswer.trashReasonLabel` | Trash reason | Причина за коша | **Причина за отфрлање** |
| `outcome.answered` | Answered | Отговорено | **Одговорено** |
| `outcome.busy` | Busy | Заето | **Зафатено** |
| `outcome.call_again` | Call Again | Повторно обаждане | **Јави се повторно** |
| `outcome.cancelled` | Cancelled | Отказ | **Откажана** |
| `outcome.confirmed` | Confirmed | Потвърдена | **Потврдена** |
| `outcome.failed` | Failed | Неуспешно | **Неуспешно** |
| `outcome.interested` | Interested | Заинтересован | **Заинтересиран** |
| `outcome.no_answer` | No Answer | Не отговаря | **Не се јавува** |
| `outcome.not_interested` | Not Interested | Не е заинтересован | **Не е заинтересиран** |
| `outcome.skipped` | Skipped | Пропуснат | **Прескокнат** |

_(+3 more keys in this domain)_

## Cancellation reasons

| key | EN | BG | МК |
|---|---|---|---|
| `cancelReason.bought_elsewhere` | Already ordered | Вече е поръчал | **Веќе нарачал** |
| `cancelReason.changed_mind` | He will think about it | Ще си помисли | **Ќе размисли** |
| `cancelReason.duplicate_order` | Duplicate order | Дублирана поръчка | **Дуплирана нарачка** |
| `cancelReason.family_refused` | Husband / wife refused | Съпруг / съпруга отказа | **Сопругот / сопругата одби** |
| `cancelReason.no_money` | No money | Няма пари | **Нема пари** |
| `cancelReason.not_interested` | Not interested | Не се интересува | **Не е заинтересиран** |
| `cancelReason.not_satisfied` | Not satisfied | Не е доволен | **Не е задоволен** |
| `cancelReason.other` | Other | Друго | **Друго** |
| `cancelReason.price_too_high` | Price too high | Висока цена | **Превисока цена** |
| `cancelReason.still_using_product` | Still using product | Още ползва продукта | **Сè уште го користи производот** |
| `cancelReason.will_call_back` | He will call us | Ще ни се обади | **Ќе ни се јави** |
| `cancelReason.wrong_product` | Wrong product | Грешен продукт | **Погрешен производ** |

## Return / trash reasons

| key | EN | BG | МК |
|---|---|---|---|
| `returnReason.changed_mind_after_ship` | Changed mind after ship | Отказ след изпращане | **Се предомисли по испраќање** |
| `returnReason.damaged_in_transit` | Damaged in transit | Повредена при транспорт | **Оштетена при транспорт** |
| `returnReason.not_picked_up` | Not picked up | Не е потърсена | **Не е подигната** |
| `returnReason.other` | Other | Друго | **Друго** |
| `returnReason.refused_at_door` | Refused at door | Отказана на вратата | **Одбиена на врата** |
| `returnReason.undeliverable_address` | Undeliverable address | Недоставим адрес | **Недостапна адреса** |
| `returnReason.wrong_item_shipped` | Wrong item shipped | Изпратен грешен продукт | **Испратен погрешен производ** |
| `trashReason.not_reachable` | Unreachable (never answers) | Недостъпен (не вдига) | **Недостапен (не се јавува)** |
| `trashReason.other` | Other reason | Друга причина | **Друга причина** |
| `trashReason.rude` | Person is rude | Грубо държане | **Лицето е грубо** |
| `trashReason.uncooperative` | Does not cooperate | Не съдейства | **Не соработува** |
| `trashReason.wrong_number` | Wrong number | Грешен номер | **Погрешен број** |
| `trashReason.wrong_person` | Wrong person answered | Отговори грешен човек | **Се јави погрешно лице** |

## Delivery

| key | EN | BG | МК |
|---|---|---|---|
| `delivery.apartment` | Apartment | Апартамент | **Стан** |
| `delivery.block` | Block | Блок | **Блок** |
| `delivery.city` | City | Град | **Град** |
| `delivery.cityVillage` | City / Village | Град / село | **Град / село** |
| `delivery.courier` | Courier | Куриер | **Курир** |
| `delivery.entry` | Entry | Вход | **Влез** |
| `delivery.floor` | Floor | Етаж | **Кат** |
| `delivery.homeAddress` | Home Address | Домашен адрес | **Домашна адреса** |
| `delivery.noOfficesMatch` | No offices match "{{query}}". {{total}} total in {{city}}. | Няма офиси за „{{query}}“. Общо {{total}} в {{city}}. | **Нема офиси за „{{query}}“. Вкупно {{total}} во {{city}}.** |
| `delivery.office` | Office | Офис | **Офис** |
| `delivery.officesCount_one` | {{count}} office | {{count}} офис | **{{count}} офис** |
| `delivery.officesCount_other` | {{count}} offices | {{count}} офиса | **{{count}} офиси** |
| `delivery.pickCityFirst` | Pick a city first | Първо избери град | **Прво избери град** |
| `delivery.pickCityFirstSuggestions` | Pick a city first for suggestions | Първо избери град за предложения | **Прво избери град за предлози** |
| `delivery.postalCode` | Postal Code | Пощенски код | **Поштенски код** |
| `delivery.quarterComplex` | Quarter / Complex | Квартал / комплекс | **Населба / комплекс** |
| `delivery.quarterOptionalPlaceholder` | Optional — pick a city first | По избор — първо избери град | **По избор — прво избери град** |
| `delivery.searchOfficePlaceholder` | Search by code, name or address… | Търси по код, име или адрес… | **Пребарај по код, име или адреса…** |
| `delivery.street` | Street | Улица | **Улица** |
| `delivery.typeCityPlaceholder` | Type a city — С / S / София | Въведи град — С / София | **Внеси град — С / S / София** |
| `delivery.typeCityVillagePlaceholder` | Type a city or village… | Въведи град или село… | **Внеси град или село…** |
| `delivery.typeQuarterPlaceholder` | Type a quarter… | Въведи квартал… | **Внеси населба…** |
| `delivery.typeStreetPlaceholder` | Type a street… | Въведи улица… | **Внеси улица…** |

## Calls page

| key | EN | BG | МК |
|---|---|---|---|
| `callsPage.activeCallInProgress` | Active call in progress — see the widget below. | В момента тече разговор — виж панела по-долу. | **Во тек е активен повик — види го панелот подолу.** |
| `callsPage.call` | Call | Обади се | **Јави се** |
| `callsPage.cancellationFailed` | Could not record cancellation | Отказът не можа да се запише | **Откажувањето не можеше да се запише** |
| `callsPage.cancellationRecorded` | Cancellation recorded | Отказът е записан | **Откажувањето е запишано** |
| `callsPage.chooseList` | Choose a list | Изберете списък | **Избери список** |
| `callsPage.confirmFailed` | Could not confirm order | Поръчката не можа да се потвърди | **Нарачката не можеше да се потврди** |
| `callsPage.confirmOrderTitle` | Confirm Order — {{phone}} | Потвърди поръчка — {{phone}} | **Потврди нарачка — {{phone}}** |
| `callsPage.dialANumber` | Dial a number | Набери номер | **Набери број** |
| `callsPage.dialBtn` | Dial {{phone}} | Набери {{phone}} | **Набери {{phone}}** |
| `callsPage.dialNewNumber` | Dial new number | Нов номер | **Набери нов број** |
| `callsPage.emptyListDesc` | This list has no callable customers right now (all completed or on hold). Pick another list in the topbar or type a phone number to dial directly. | В този списък няма клиенти за обаждане (всички са завършени или запазени). Избери друг списък от горната лента или въведи номер за директно набиране. | **Овој список моментално нема клиенти за јавување (сите се завршени или задржани). Избери друг список во горната лента или внеси телефонски број за директно бирање.** |
| `callsPage.enterPhone` | Enter a phone number | Въведи телефонен номер | **Внеси телефонски број** |
| `callsPage.enterPhoneDesc` | At least 6 digits required. | Нужни са поне 6 цифри. | **Потребни се барем 6 цифри.** |
| `callsPage.haveListsDesc_one` | You have {{count}} list assigned to you — pick one to start, or type a phone number to dial directly. | Имаш {{count}} възложен списък — избери го, за да започнеш, или въведи номер за директно набиране. | **Имаш {{count}} доделен список — избери го за да започнеш, или внеси телефонски број за директно бирање.** |
| `callsPage.haveListsDesc_other` | You have {{count}} lists assigned to you — pick one to start, or type a phone number to dial directly. | Имаш {{count}} възложени списъка — избери един, за да започнеш, или въведи номер за директно набиране. | **Имаш {{count}} доделени списоци — избери еден за да започнеш, или внеси телефонски број за директно бирање.** |
| `callsPage.listsCount_one` | {{count}} list | {{count}} списък | **{{count}} список** |
| `callsPage.listsCount_other` | {{count}} lists | {{count}} списъка | **{{count}} списоци** |
| `callsPage.loadOrderFailed` | Could not load order | Поръчката не можа да се зареди | **Нарачката не можеше да се вчита** |
| `callsPage.markedAs` | Marked as | Маркирано като | **Означено како** |
| `callsPage.markedConfirmed` | Marked as confirmed. | Маркирана като потвърдена. | **Означена како потврдена.** |
| `callsPage.markedTrash` | Marked as trash | Преместено в коша | **Означено како отфрлено** |
| `callsPage.movedToCallAgain` | Moved to Call Again | Преместено в Повторни обаждания | **Преместено во Повторно јавување** |
| `callsPage.nextCustomer` | Next customer | Следващ клиент | **Следен клиент** |
| `callsPage.noAnswerFailed` | Could not record No Answer | „Не отговаря“ не можа да се запише | **„Не одговара“ не можеше да се запише** |
| `callsPage.noAnswerResurface` | No answer — will resurface tomorrow. | Без отговор — ще се появи отново утре. | **Без одговор — ќе се појави повторно утре.** |
| `callsPage.noAssignedDesc` | You don't have an assigned customer at the moment. Type a phone number in the topbar to dial a specific customer, or wait for a list to be assigned to you. | В момента нямаш възложен клиент. Въведи номер в горната лента, за да се обадиш на конкретен клиент, или изчакай да ти бъде възложен списък. | **Моментално немаш доделен клиент. Внеси телефонски број во горната лента за да се јавиш на конкретен клиент, или почекај да ти биде доделен список.** |
| `callsPage.nothingToCall` | Nothing to call right now | Няма какво да се звъни в момента | **Моментално нема кому да се јавиш** |
| `callsPage.orderConfirmed` | Order confirmed | Поръчката е потвърдена | **Нарачката е потврдена** |
| `callsPage.phoneNumber` | Phone number | Телефонен номер | **Телефонски број** |
| `callsPage.queueLabel` | Queue | Опашка | **Редица** |

_(+4 more keys in this domain)_

## Order editor

| key | EN | BG | МК |
|---|---|---|---|
| `orderModal.addNotes` | Add notes... | Добави бележки... | **Додај белешки...** |
| `orderModal.addProduct` | Add Product | Добави продукт | **Додај производ** |
| `orderModal.address` | Address | Адрес | **Адреса** |
| `orderModal.amountPaid` | Amount Paid | Платена сума | **Платен износ** |
| `orderModal.attrDialogDesc` | This will permanently change who is recorded as the original agent who confirmed this order. It affects agent performance reports and package counts. This action is audited. | Това трайно променя кой е записан като оригиналния агент, потвърдил поръчката. Влияе на отчетите за представяне и броя пакети. Действието се одитира. | **Ова трајно менува кој е запишан како оригинален агент што ја потврдил нарачката. Влијае врз извештаите за учинок и бројот на пакети. Дејството се евидентира.** |
| `orderModal.attrDialogTitle` | Change Original Sales Credit? | Смяна на оригиналния кредит за продажбата? | **Промена на оригиналната заслуга за продажбата?** |
| `orderModal.callOutcome` | Call Outcome | Резултат от обаждането | **Резултат од повикот** |
| `orderModal.cancelNoteRequired` | Comment required | Нужен е коментар | **Потребен е коментар** |
| `orderModal.cancelNoteRequiredDesc` | Type a comment explaining the "Other" reason before saving. | Опиши причината за избор „Друго“ преди запазване. | **Напиши коментар за причината „Друго“ пред зачувување.** |
| `orderModal.cancelReasonRequired` | Cancellation reason required | Нужна е причина за отказа | **Потребна е причина за откажување** |
| `orderModal.cancelReasonRequiredDesc` | Pick a reason before saving. | Избери причина преди запазване. | **Избери причина пред зачувување.** |
| `orderModal.changeCreditedAgent` | Change credited agent | Смени кредитирания агент | **Смени го агентот со заслуга** |
| `orderModal.chooseProduct` | Choose product | Избери продукт | **Избери производ** |
| `orderModal.city` | City | Град | **Град** |
| `orderModal.clearSalesCredit` | Clear sales credit | Изчисти кредита | **Исчисти ја заслугата** |
| `orderModal.colPrice` | Price | Цена | **Цена** |
| `orderModal.colProduct` | Product | Продукт | **Производ** |
| `orderModal.colQty` | Qty | Бр. | **Кол.** |
| `orderModal.colTotal` | Total | Общо | **Вкупно** |
| `orderModal.confirmCreditChange` | Confirm Credit Change | Потвърди смяната | **Потврди ја промената** |
| `orderModal.confirmedBy` | Confirmed By: | Потвърдена от: | **Потврдена од:** |
| `orderModal.creditChangedDesc` | The original confirmer has been changed. | Оригиналният потвърдител е сменен. | **Оригиналниот потврдувач е сменет.** |
| `orderModal.creditClearedDesc` | Sales credit has been cleared. | Кредитът е изчистен. | **Заслугата за продажбата е исчистена.** |
| `orderModal.creditUpdated` | Sales credit updated | Кредитът е обновен | **Заслугата е ажурирана** |
| `orderModal.current` | Current: | Текущ: | **Тековно:** |
| `orderModal.customerInfo` | Customer Info | Данни за клиента | **Податоци за клиентот** |
| `orderModal.delayedBadge` | ⏱ Delayed Shipment — Ship After: {{date}} | ⏱ Отложено изпращане — след: {{date}} | **⏱ Одложено испраќање — испрати по: {{date}}** |
| `orderModal.deliveryInfo` | Delivery / Additional Info | Доставка / допълнителна информация | **Испорака / дополнителни податоци** |
| `orderModal.deliveryPlaceholder` | e.g. weekdays after 6pm, ring intercom... | напр. делници след 18ч, звънни на домофона... | **пр. работни дена по 18ч, ѕвони на интерфонот...** |
| `orderModal.editScript` | Edit Script | Редактирай скрипта | **Уреди ја скриптата** |

_(+54 more keys in this domain)_

## Lead statuses

| key | EN | BG | МК |
|---|---|---|---|
| `leadStatus.confirmed` | Confirmed | Потвърден | **Потврден** |
| `leadStatus.interested` | Interested | Заинтересован | **Заинтересиран** |
| `leadStatus.no_answer` | No Answer | Не отговаря | **Не се јавува** |
| `leadStatus.not_contacted` | Not Contacted | Без контакт | **Неконтактиран** |
| `leadStatus.not_interested` | Not Interested | Незаинтересован | **Незаинтересиран** |

## Break button

| key | EN | BG | МК |
|---|---|---|---|
| `breakButton.breakEndedDesc` | You were on break for {{duration}}. | Беше в почивка {{duration}}. | **Беше на пауза {{duration}}.** |
| `breakButton.breakEndedTitle` | Break ended | Почивката приключи | **Паузата заврши** |
| `breakButton.endBreak` | End Break | Край на почивката | **Заврши пауза** |
| `breakButton.endFailed` | Could not end break | Почивката не можа да приключи | **Паузата не можеше да заврши** |
| `breakButton.onBreakDesc` | Timer started. Press End Break when you’re back. | Таймерът тръгна. Натисни „Край на почивката“, когато се върнеш. | **Тајмерот почна. Притисни „Заврши пауза“ кога ќе се вратиш.** |
| `breakButton.onBreakTitle` | On break | В почивка | **На пауза** |
| `breakButton.startFailed` | Could not start break | Почивката не можа да започне | **Паузата не можеше да започне** |
| `breakButton.takeBreak` | Take Break | Почивка | **Земи пауза** |

## Notifications (bell)

| key | EN | BG | МК |
|---|---|---|---|
| `notif.congrats` | Congratulations! | Честито! | **Честитки!** |
| `notif.copyFailed` | Couldn’t copy the number | Номерът не можа да се копира | **Бројот не можеше да се копира** |
| `notif.copyNumber` | Copy number | Копирай номера | **Копирај го бројот** |
| `notif.empty` | No notifications yet | Още няма известия | **Засега нема известувања** |
| `notif.header` | Notifications | Известия | **Известувања** |
| `notif.kaChing` | Ka-ching! Great work 💰 | Ка-чинг! Браво 💰 | **Ка-чинг! Одлична работа 💰** |
| `notif.markAllRead` | Mark all read | Маркирай всички като прочетени | **Означи ги сите како прочитани** |
| `notif.nextOne` | We'll get the next one. | Следващия път ще успеем. | **Ќе ја земеме следната.** |
| `notif.numberCopied` | Number copied | Номерът е копиран | **Бројот е копиран** |
| `notif.refundProcessed` | Refund processed | Обработено връщане | **Обработено враќање** |
| `notif.shippedUnpaid.body` | Order {{order}} ({{customer}}) shipped {{days}} days ago and is still unpaid — call the client. | Поръчка {{order}} ({{customer}}) е изпратена преди {{days}} дни и още не е платена — обади се на клиента. | **Нарачката {{order}} ({{customer}}) е испратена пред {{days}} дена и уште не е платена — јави се на клиентот.** |
| `notif.shippedUnpaid.title` | Delivery not picked up | Пратката не е взета | **Пратката не е подигната** |
| `notif.unpaidDigest.body` | {{total}} shipped orders unpaid {{days}}+ days ({{new}} new today). Oldest: {{oldestOrder}} — {{oldestDays}} days. | {{total}} изпратени поръчки са неплатени над {{days}} дни ({{new}} нови днес). Най-стара: {{oldestOrder}} — {{oldestDays}} дни. | **{{total}} испратени нарачки се неплатени над {{days}} дена ({{new}} нови денес). Најстара: {{oldestOrder}} — {{oldestDays}} дена.** |
| `notif.unpaidDigest.staleSync` | Last BigArena sync was {{syncAgeHours}}h ago — some of these may already be paid. | Последният BigArena синхрон е отпреди {{syncAgeHours}} ч. — част от тях може вече да са платени. | **Последната синхронизација со BigArena беше пред {{syncAgeHours}} ч. — некои од нив можеби се веќе платени.** |
| `notif.unpaidDigest.title` | Unpaid deliveries | Неплатени пратки | **Неплатени пратки** |

---

_260 strings listed. Reviewed wording lands in `mk.json` — keys never change._

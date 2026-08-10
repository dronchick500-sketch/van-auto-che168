const { chromium } = require('playwright');
const fs = require('fs');


/*
==================================================
VAN AUTO — РАСЧЁТ ИТОГОВОЙ СТОИМОСТИ
==================================================
*/


const CARS_FILE = 'cars.json';
const RATES_FILE = 'rates.json';


/*
==================================================
ИСТОЧНИКИ КУРСОВ
==================================================
*/


const VTB_URL =
  'https://www.vtb.ru/personal/platezhi-i-perevody/obmen-valjuty/yuan/';


const VTB_TRANSFER_URL =
  'https://www.vtb.ru/personal/platezhi-i-perevody/perevody-v-yuani/';


const CBR_URL =
  'https://www.cbr.ru/scripts/XML_daily.asp';



/*
==================================================
БИЗНЕС-ФОРМУЛА VAN AUTO
==================================================
*/


// Банковская комиссия 2%
const BANK_COMMISSION = 0.02;


// Постоянная сумма на автомобиль
const FIXED_RUB = 250000;


// Доставка до Санкт-Петербурга
const DELIVERY_SPB_RUB = 210000;


// Граница стоимости автомобиля
const LOW_PRICE_LIMIT_CNY = 110000;


// Расходы по Китаю
const CHINA_LOW_CNY = 12500;
const CHINA_HIGH_CNY = 13000;


// Расходы по России
const RUSSIA_LOW_RUB = 223000;
const RUSSIA_HIGH_RUB = 273000;



/*
==================================================
ТАМОЖЕННЫЕ НАСТРОЙКИ
==================================================
*/


const CUSTOMS_OPERATION_FEE_RUB = 689;


// Льготный утиль
const UTIL_BASE_RUB = 20000;
const UTIL_NEW_COEFF = 0.17;
const UTIL_USED_COEFF = 0.26;


// На сайте написано:
// "До 160 л.с."
//
// Фактически:
// максимум 159 л.с.
const SAFE_POWER_LIMIT_HP = 159;


// Защита возле границы 3 и 5 лет
const AGE_BOUNDARY_GUARD_MONTHS = 2;



/*
==================================================
JSON
==================================================
*/


function loadJson(path, fallback) {

  try {

    if (!fs.existsSync(path)) {
      return fallback;
    }


    return JSON.parse(
      fs.readFileSync(
        path,
        'utf8'
      )
    );

  } catch (error) {

    console.log(
      `Не удалось прочитать ${path}:`,
      error.message
    );


    return fallback;

  }

}



function saveJson(path, data) {

  fs.writeFileSync(

    path,

    JSON.stringify(
      data,
      null,
      2
    ) + '\n',

    'utf8'

  );

}



/*
==================================================
ЧИСЛА
==================================================
*/


function toNumber(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }


  const normalized =
    String(value)

      .replace(/\u00A0/g, '')
      .replace(/\u202F/g, '')
      .replace(/\s/g, '')
      .replace(',', '.');


  const number =
    Number(normalized);


  return Number.isFinite(number)
    ? number
    : null;

}



function roundRub(value) {

  return Math.round(value);

}



/*
==================================================
ЦБ РФ
==================================================
*/


function parseCbrRate(xml, code) {

  const blocks =
    xml.match(
      /<Valute[\s\S]*?<\/Valute>/g
    ) || [];


  for (
    const block
    of blocks
  ) {

    const codeMatch =
      block.match(
        /<CharCode>([^<]+)<\/CharCode>/i
      );


    if (
      !codeMatch ||
      codeMatch[1].trim() !== code
    ) {
      continue;
    }


    const nominalMatch =
      block.match(
        /<Nominal>([\d.,]+)<\/Nominal>/i
      );


    const valueMatch =
      block.match(
        /<Value>([\d.,]+)<\/Value>/i
      );


    const nominal =
      nominalMatch
        ? toNumber(nominalMatch[1])
        : null;


    const value =
      valueMatch
        ? toNumber(valueMatch[1])
        : null;


    if (
      !nominal ||
      !value
    ) {
      return null;
    }


    return value / nominal;

  }


  return null;

}



async function getCbrRates() {

  console.log(
    '\n===== КУРСЫ ЦБ РФ =====\n'
  );


  const response =
    await fetch(
      CBR_URL,
      {
        headers: {

          'User-Agent':
            'Mozilla/5.0 VAN-AUTO/1.0'

        }
      }
    );


  if (!response.ok) {

    throw new Error(
      `ЦБ РФ HTTP ${response.status}`
    );

  }


  const xml =
    await response.text();


  const cnyRub =
    parseCbrRate(
      xml,
      'CNY'
    );


  const eurRub =
    parseCbrRate(
      xml,
      'EUR'
    );


  if (
    !cnyRub ||
    !eurRub
  ) {

    throw new Error(
      'Не удалось получить CNY/EUR из ЦБ РФ'
    );

  }


  console.log(
    'ЦБ CNY/RUB:',
    cnyRub
  );


  console.log(
    'ЦБ EUR/RUB:',
    eurRub
  );


  return {
    cnyRub,
    eurRub
  };

}



/*
==================================================
КАНДИДАТЫ КУРСА НА СТРАНИЦЕ ВТБ
==================================================
*/


function extractRateCandidates(
  text,
  cbrCnyRub
) {

  const lines =
    String(text)

      .split('\n')

      .map(
        line =>
          line
            .replace(/\s+/g, ' ')
            .trim()
      )

      .filter(Boolean);


  const candidates = [];


  for (
    let index = 0;
    index < lines.length;
    index++
  ) {

    const line =
      lines[index];


    if (
      !/CNY|юан|китайск/i.test(line)
    ) {
      continue;
    }


    const start =
      Math.max(
        0,
        index - 10
      );


    const end =
      Math.min(
        lines.length,
        index + 25
      );


    const snippet =
      lines
        .slice(start, end)
        .join('\n');


    /*
    Сначала ищем цифру рядом
    со словами продажи.
    */

    const directPatterns = [

      /(?:Продажа|Продать|курс продажи)[^\d]{0,120}(\d{1,2}[.,]\d{2,6})/i,

      /(\d{1,2}[.,]\d{2,6})[^\d]{0,120}(?:Продажа|Продать|курс продажи)/i

    ];


    for (
      const pattern
      of directPatterns
    ) {

      const match =
        snippet.match(pattern);


      if (!match) {
        continue;
      }


      const number =
        toNumber(
          match[1]
        );


      if (
        number &&
        number >= cbrCnyRub * 0.75 &&
        number <= cbrCnyRub * 1.70
      ) {

        candidates.push({
          value: number,
          priority: 10
        });

      }

    }


    /*
    Если явной подписи нет,
    берём разумные значения
    возле CNY.
    */

    const numbers =
      snippet.match(
        /\b\d{1,2}[.,]\d{2,6}\b/g
      ) || [];


    for (
      const raw
      of numbers
    ) {

      const number =
        toNumber(raw);


      if (
        number &&
        number >= cbrCnyRub * 0.75 &&
        number <= cbrCnyRub * 1.70
      ) {

        candidates.push({
          value: number,
          priority: 1
        });

      }

    }

  }


  return candidates;

}



/*
==================================================
ВТБ — ОСНОВНАЯ СТРАНИЦА
==================================================
*/


async function tryVtbMainPage(
  browser,
  cbrCnyRub
) {

  console.log(
    '\nПробуем основную страницу курса ВТБ...'
  );


  const context =
    await browser.newContext({

      locale:
        'ru-RU',

      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/126.0.0.0 Safari/537.36',

      viewport: {
        width: 1440,
        height: 1200
      }

    });


  const page =
    await context.newPage();


  try {

    await page.goto(

      VTB_URL,

      {
        waitUntil:
          'domcontentloaded',

        timeout:
          45000
      }

    );


    await page.waitForTimeout(
      7000
    );


    const text =
      await page
        .locator('body')
        .innerText({
          timeout:
            15000
        });


    console.log(
      'VTB main text length:',
      text.length
    );


    const candidates =
      extractRateCandidates(
        text,
        cbrCnyRub
      );


    const preferred =
      candidates

        .filter(
          item =>
            item.priority === 10
        )

        .map(
          item =>
            item.value
        );


    const ordinary =
      candidates

        .filter(
          item =>
            item.priority === 1
        )

        .map(
          item =>
            item.value
        );


    let rate =
      null;


    if (
      preferred.length
    ) {

      rate =
        preferred[0];

    }

    else if (
      ordinary.length
    ) {

      /*
      Если нашли несколько разумных
      банковских курсов рядом с CNY,
      для покупки юаня выбираем
      большее значение.
      */

      rate =
        Math.max(
          ...ordinary
        );

    }


    if (
      rate &&
      rate >= cbrCnyRub * 0.75 &&
      rate <= cbrCnyRub * 1.70
    ) {

      console.log(
        'Курс ВТБ с основной страницы:',
        rate
      );


      await context.close();


      return {

        rate,

        source:
          'VTB live',

        observedAt:
          new Date()
            .toISOString()

      };

    }


    console.log(
      'На основной странице ВТБ курс не распознан.'
    );


  } catch (error) {

    console.log(
      'Ошибка основной страницы ВТБ:',
      error.message
    );

  }


  await context.close();


  return null;

}



/*
==================================================
ВТБ — СТРАНИЦА ПЕРЕВОДОВ В ЮАНЯХ
==================================================
*/


async function tryVtbTransferPage(
  browser,
  cbrCnyRub
) {

  console.log(
    '\nПробуем резервную страницу ВТБ...'
  );


  const context =
    await browser.newContext({

      locale:
        'ru-RU',

      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/126.0.0.0 Safari/537.36',

      viewport: {
        width: 1440,
        height: 1200
      }

    });


  const page =
    await context.newPage();


  try {

    await page.goto(

      VTB_TRANSFER_URL,

      {
        waitUntil:
          'domcontentloaded',

        timeout:
          45000
      }

    );


    await page.waitForTimeout(
      6000
    );


    let text =
      await page
        .locator('body')
        .innerText({
          timeout:
            15000
        });


    text =
      String(text)

        .replace(
          /\u00A0/g,
          ' '
        )

        .replace(
          /\u202F/g,
          ' '
        );


    console.log(
      'VTB transfer text length:',
      text.length
    );


    /*
    ВТБ сейчас использует пример вида:

    20 млн ₽ ≈ 1 447 345 юаней

    Поэтому:
    курс = RUB / CNY
    */


    let rubAmount =
      null;


    let cnyAmount =
      null;



    /*
    Вариант:
    20 млн ₽ ≈ 1 447 345 юаней
    */

    const millionMatch =
      text.match(

        /(\d+(?:[.,]\d+)?)\s*млн\.?\s*₽[\s\S]{0,80}?([\d\s]+)\s*(?:юан|CNY)/i

      );


    if (
      millionMatch
    ) {

      rubAmount =

        Number(
          millionMatch[1]
            .replace(
              ',',
              '.'
            )
        ) *

        1000000;


      cnyAmount =

        Number(
          millionMatch[2]
            .replace(
              /\s/g,
              ''
            )
        );

    }



    /*
    Вариант:
    20 000 000 ₽ ≈ 1 447 345 юаней
    */

    if (
      !rubAmount ||
      !cnyAmount
    ) {

      const fullMatch =
        text.match(

          /([\d\s]{5,})\s*₽[\s\S]{0,80}?([\d\s]{4,})\s*(?:юан|CNY)/i

        );


      if (
        fullMatch
      ) {

        rubAmount =

          Number(
            fullMatch[1]
              .replace(
                /\s/g,
                ''
              )
          );


        cnyAmount =

          Number(
            fullMatch[2]
              .replace(
                /\s/g,
                ''
              )
          );

      }

    }



    if (
      rubAmount &&
      cnyAmount
    ) {

      const rate =
        rubAmount /
        cnyAmount;


      console.log(
        'ВТБ RUB amount:',
        rubAmount
      );


      console.log(
        'ВТБ CNY amount:',
        cnyAmount
      );


      console.log(
        'Расчётный курс:',
        rate
      );


      if (
        rate >= cbrCnyRub * 0.75 &&
        rate <= cbrCnyRub * 1.70
      ) {

        await context.close();


        return {

          rate,

          source:
            'VTB transfer page',

          observedAt:
            new Date()
              .toISOString()

        };

      }

    }


    console.log(
      'На резервной странице ВТБ курс не распознан.'
    );


    console.log(
      text
        .slice(
          0,
          3000
        )
    );


  } catch (error) {

    console.log(
      'Ошибка резервной страницы ВТБ:',
      error.message
    );

  }


  await context.close();


  return null;

}



/*
==================================================
ПОЛУЧЕНИЕ КУРСА ВТБ
==================================================
*/


async function getVtbCnySellRate(
  browser,
  cbrCnyRub,
  previousRates
) {

  console.log(
    '\n===== КУРС ВТБ CNY/RUB =====\n'
  );


  /*
  1. Основная страница ВТБ
  */

  const main =
    await tryVtbMainPage(
      browser,
      cbrCnyRub
    );


  if (main) {

    return main;

  }


  /*
  2. Резервная официальная
  страница ВТБ.
  */

  const transfer =
    await tryVtbTransferPage(
      browser,
      cbrCnyRub
    );


  if (transfer) {

    return transfer;

  }


  /*
  3. Последний сохранённый курс,
  если он не старше 48 часов.
  */


  const previousRate =
    toNumber(
      previousRates
        ?.vtbCnySell
    );


  const previousAt =
    previousRates
      ?.vtbObservedAt

      ? new Date(
          previousRates
            .vtbObservedAt
        )

      : null;


  if (
    previousRate &&
    previousAt &&
    !Number.isNaN(
      previousAt.getTime()
    )
  ) {

    const ageHours =

      (
        Date.now() -
        previousAt.getTime()
      ) /

      3600000;


    if (
      ageHours <= 48
    ) {

      console.log(
        'Используем последний сохранённый курс ВТБ:',
        previousRate
      );


      return {

        rate:
          previousRate,

        source:
          'VTB saved',

        observedAt:
          previousRates
            .vtbObservedAt

      };

    }

  }


  /*
  Никаких придуманных курсов.
  */

  console.log(
    'Курс ВТБ получить не удалось.'
  );


  return {

    rate:
      null,

    source:
      'unavailable',

    observedAt:
      null

  };

}



/*
==================================================
ВОЗРАСТ АВТОМОБИЛЯ
==================================================
*/


function parseYearMonth(value) {

  if (!value) {
    return null;
  }


  const match =
    String(value)

      .trim()

      .match(
        /(20\d{2})[.\-/年](\d{1,2})/
      );


  if (!match) {
    return null;
  }


  const year =
    Number(
      match[1]
    );


  const month =
    Number(
      match[2]
    );


  if (
    !year ||
    month < 1 ||
    month > 12
  ) {

    return null;

  }


  return {
    year,
    month
  };

}



function getAgeInfo(car) {

  const production =
    parseYearMonth(

      car.productionDate ||

      car.manufactureDate ||

      car.buildDate

    );


  const registration =
    parseYearMonth(
      car.registrationDate
    );


  const selected =
    production ||
    registration;


  if (!selected) {

    return {

      ok:
        false,

      reason:
        'Нет даты выпуска/регистрации'

    };

  }


  const now =
    new Date();


  const currentYear =
    now.getUTCFullYear();


  const currentMonth =
    now.getUTCMonth() + 1;


  const ageMonths =

    (
      currentYear -
      selected.year
    ) * 12 +

    (
      currentMonth -
      selected.month
    );


  let group;


  if (
    ageMonths <= 36
  ) {

    group =
      'under3';

  }

  else if (
    ageMonths <= 60
  ) {

    group =
      '3to5';

  }

  else {

    group =
      'over5';

  }


  const source =
    production

      ? 'productionDate'

      : 'registrationDate';


  /*
  Если точной даты производства нет,
  защищаем границу возрастных категорий.
  */

  if (!production) {

    const near3 =

      Math.abs(
        ageMonths - 36
      ) <=

      AGE_BOUNDARY_GUARD_MONTHS;


    const near5 =

      Math.abs(
        ageMonths - 60
      ) <=

      AGE_BOUNDARY_GUARD_MONTHS;


    if (
      near3 ||
      near5
    ) {

      return {

        ok:
          false,

        reason:
          'Нужна точная дата производства: автомобиль близко к границе таможенной возрастной группы',

        source,

        ageMonths

      };

    }

  }


  return {

    ok:
      true,

    source,

    ageMonths,

    group,

    year:
      selected.year,

    month:
      selected.month

  };

}



/*
==================================================
ТАМОЖНЯ — ДО 3 ЛЕТ
==================================================
*/


function dutyForUnder3(
  valueEur,
  engineCc
) {

  let percent;
  let minPerCc;


  if (
    valueEur <= 8500
  ) {

    percent =
      0.54;

    minPerCc =
      2.5;

  }

  else if (
    valueEur <= 16700
  ) {

    percent =
      0.48;

    minPerCc =
      3.5;

  }

  else if (
    valueEur <= 42300
  ) {

    percent =
      0.48;

    minPerCc =
      5.5;

  }

  else if (
    valueEur <= 84500
  ) {

    percent =
      0.48;

    minPerCc =
      7.5;

  }

  else if (
    valueEur <= 169000
  ) {

    percent =
      0.48;

    minPerCc =
      15;

  }

  else {

    percent =
      0.48;

    minPerCc =
      20;

  }


  return Math.max(

    valueEur *
      percent,

    engineCc *
      minPerCc

  );

}



/*
==================================================
ТАМОЖНЯ — 3–5 ЛЕТ
==================================================
*/


function ccRateFor3to5(
  engineCc
) {

  if (
    engineCc <= 1000
  ) {
    return 1.5;
  }


  if (
    engineCc <= 1500
  ) {
    return 1.7;
  }


  if (
    engineCc <= 1800
  ) {
    return 2.5;
  }


  if (
    engineCc <= 2300
  ) {
    return 2.7;
  }


  if (
    engineCc <= 3000
  ) {
    return 3.0;
  }


  return 3.6;

}



/*
==================================================
ТАМОЖНЯ — СТАРШЕ 5 ЛЕТ
==================================================
*/


function ccRateForOver5(
  engineCc
) {

  if (
    engineCc <= 1000
  ) {
    return 3.0;
  }


  if (
    engineCc <= 1500
  ) {
    return 3.2;
  }


  if (
    engineCc <= 1800
  ) {
    return 3.5;
  }


  if (
    engineCc <= 2300
  ) {
    return 4.8;
  }


  if (
    engineCc <= 3000
  ) {
    return 5.0;
  }


  return 5.7;

}



/*
==================================================
РАСЧЁТ ТАМОЖЕННОЙ ПОШЛИНЫ
==================================================
*/


function calculateCustomsDutyRub(
  car,
  cbr
) {

  const priceCny =
    toNumber(
      car.priceCny
    );


  const engineCc =
    toNumber(
      car.engineVolumeCc
    );


  if (!priceCny) {

    return {

      ok:
        false,

      reason:
        'Нет цены CHE168'

    };

  }


  /*
  Чистые EV пока отдельно.
  */

  if (
    String(
      car.fuel || ''
    )

      .toLowerCase()

      .includes(
        'электро'
      )
  ) {

    return {

      ok:
        false,

      reason:
        'Для чистого электромобиля нужен отдельный расчёт'

    };

  }


  if (!engineCc) {

    return {

      ok:
        false,

      reason:
        'Нет объёма двигателя'

    };

  }


  const age =
    getAgeInfo(
      car
    );


  if (!age.ok) {

    return {

      ok:
        false,

      reason:
        age.reason,

      age

    };

  }


  const valueEur =

    priceCny *

    cbr.cnyRub /

    cbr.eurRub;


  let dutyEur;


  if (
    age.group ===
    'under3'
  ) {

    dutyEur =
      dutyForUnder3(
        valueEur,
        engineCc
      );

  }

  else if (
    age.group ===
    '3to5'
  ) {

    dutyEur =

      engineCc *

      ccRateFor3to5(
        engineCc
      );

  }

  else {

    dutyEur =

      engineCc *

      ccRateForOver5(
        engineCc
      );

  }


  const dutyRub =
    roundRub(

      dutyEur *
      cbr.eurRub

    );


  return {

    ok:
      true,

    dutyRub,

    dutyEur,

    customsValueEur:
      valueEur,

    age

  };

}



/*
==================================================
УТИЛЬ
==================================================
*/


function calculateUtilFeeRub(
  car,
  ageInfo
) {

  const power =
    toNumber(
      car.power
    );


  if (!power) {

    return {

      ok:
        false,

      reason:
        'Нет мощности двигателя'

    };

  }


  /*
  В интерфейсе:
  До 160 л.с.

  Фактически:
  до 159 включительно.
  */

  if (
    power >
    SAFE_POWER_LIMIT_HP
  ) {

    return {

      ok:
        false,

      reason:
        `Мощность ${power} л.с. выше лимита ${SAFE_POWER_LIMIT_HP} л.с.`

    };

  }


  if (
    !ageInfo ||
    !ageInfo.ok
  ) {

    return {

      ok:
        false,

      reason:
        'Нет надёжной возрастной группы'

    };

  }


  const coeff =

    ageInfo.group ===
    'under3'

      ? UTIL_NEW_COEFF

      : UTIL_USED_COEFF;


  return {

    ok:
      true,

    coeff,

    feeRub:
      roundRub(

        UTIL_BASE_RUB *
        coeff

      )

  };

}



/*
==================================================
ГЛАВНАЯ ФОРМУЛА VAN AUTO
==================================================
*/


function calculateCarPrice(
  car,
  rates
) {

  const priceCny =
    toNumber(
      car.priceCny
    );


  /*
  Нет китайской цены
  */

  if (!priceCny) {

    return {

      ...car,

      finalPriceRub:
        null,

      pricingStatus:
        'waiting_price',

      pricingError:
        'Нет цены CHE168'

    };

  }


  /*
  Нет ВТБ
  */

  if (
    !rates.vtbCnySell
  ) {

    return {

      ...car,

      finalPriceRub:
        null,

      pricingStatus:
        'waiting_vtb_rate',

      pricingError:
        'Нет курса ВТБ CNY/RUB'

    };

  }


  /*
  Таможня
  */

  const customs =
    calculateCustomsDutyRub(
      car,
      rates.cbr
    );


  if (!customs.ok) {

    return {

      ...car,

      finalPriceRub:
        null,

      pricingStatus:
        'customs_not_calculated',

      pricingError:
        customs.reason

    };

  }


  /*
  Утиль
  */

  const util =
    calculateUtilFeeRub(
      car,
      customs.age
    );


  if (!util.ok) {

    return {

      ...car,

      finalPriceRub:
        null,

      pricingStatus:
        'util_not_calculated',

      pricingError:
        util.reason,

      customsDutyRub:
        customs.dutyRub

    };

  }



  /*
  ==============================================
  РАСХОДЫ ПО КИТАЮ
  ==============================================
  */


  const chinaExpensesCny =

    priceCny <=
    LOW_PRICE_LIMIT_CNY

      ? CHINA_LOW_CNY

      : CHINA_HIGH_CNY;



  /*
  ==============================================
  РАСХОДЫ ПО РФ
  ==============================================
  */


  const russiaExpensesRub =

    priceCny <=
    LOW_PRICE_LIMIT_CNY

      ? RUSSIA_LOW_RUB

      : RUSSIA_HIGH_RUB;



  /*
  ==============================================
  СУММА В ЮАНЯХ

  Цена автомобиля
  + расходы по Китаю
  ==============================================
  */


  const cnyPaymentBase =

    priceCny +
    chinaExpensesCny;



  /*
  ==============================================
  ПЕРЕВОД В РУБЛИ ПО ВТБ
  ==============================================
  */


  const paymentRubBeforeBank =

    cnyPaymentBase *

    rates.vtbCnySell;



  /*
  ==============================================
  +2% КОМИССИЯ БАНКА

  Начисляется именно на:
  автомобиль + Китай
  ==============================================
  */


  const bankCommissionRub =

    paymentRubBeforeBank *

    BANK_COMMISSION;



  const cnyPaymentRub =

    paymentRubBeforeBank +

    bankCommissionRub;



  /*
  ==============================================
  ТАМОЖНЯ
  ==============================================
  */


  const customsTotalRub =

    customs.dutyRub +

    util.feeRub +

    CUSTOMS_OPERATION_FEE_RUB;



  /*
  ==============================================
  ИТОГОВАЯ СТОИМОСТЬ

  Китай по ВТБ
  + 2%
  + таможня
  + расходы РФ
  + 250 000
  + 210 000 доставка до СПб
  ==============================================
  */


  const finalPriceRub =
    roundRub(

      cnyPaymentRub +

      customsTotalRub +

      russiaExpensesRub +

      FIXED_RUB +

      DELIVERY_SPB_RUB

    );



  /*
  ==============================================
  ЗАПИСЫВАЕМ РЕЗУЛЬТАТ
  ==============================================
  */


  return {

    ...car,


    finalPriceRub,


    pricingStatus:
      'calculated',


    pricingError:
      null,


    pricingUpdatedAt:
      new Date()
        .toISOString(),



    /*
    Курсы
    */


    vtbCnyRate:
      rates.vtbCnySell,


    vtbRateSource:
      rates.vtbSource,


    cbrCnyRate:
      rates.cbr.cnyRub,


    cbrEurRate:
      rates.cbr.eurRub,



    /*
    Китай
    */


    chinaExpensesCny,


    cnyPaymentBase,


    bankCommissionRub:
      roundRub(
        bankCommissionRub
      ),


    cnyPaymentRub:
      roundRub(
        cnyPaymentRub
      ),



    /*
    Таможня
    */


    customsDutyRub:
      customs.dutyRub,


    customsDutyEur:
      Number(
        customs.dutyEur
          .toFixed(2)
      ),


    customsValueEur:
      Number(
        customs.customsValueEur
          .toFixed(2)
      ),


    customsAgeGroup:
      customs.age.group,


    customsAgeSource:
      customs.age.source,


    customsAgeMonths:
      customs.age.ageMonths,



    /*
    Утиль
    */


    utilFeeRub:
      util.feeRub,


    utilCoeff:
      util.coeff,



    /*
    Остальные расходы
    */


    customsOperationFeeRub:
      CUSTOMS_OPERATION_FEE_RUB,


    customsTotalRub,


    russiaExpensesRub,


    fixedRub:
      FIXED_RUB,


    deliverySpbRub:
      DELIVERY_SPB_RUB,



    /*
    Полная расшифровка
    */


    pricingBreakdown: {


      vehiclePriceCny:
        priceCny,


      chinaExpensesCny,


      cnyPaymentBase,


      vtbCnyRate:
        rates.vtbCnySell,


      bankCommissionPercent:
        2,


      bankCommissionRub:
        roundRub(
          bankCommissionRub
        ),


      cnyPaymentRub:
        roundRub(
          cnyPaymentRub
        ),


      customsDutyRub:
        customs.dutyRub,


      utilFeeRub:
        util.feeRub,


      customsOperationFeeRub:
        CUSTOMS_OPERATION_FEE_RUB,


      customsTotalRub,


      russiaExpensesRub,


      fixedRub:
        FIXED_RUB,


      deliverySpbRub:
        DELIVERY_SPB_RUB,


      finalPriceRub

    }

  };

}



/*
==================================================
ЗАПУСК
==================================================
*/


(async () => {


  if (
    !fs.existsSync(
      CARS_FILE
    )
  ) {

    throw new Error(
      'cars.json не найден'
    );

  }



  const cars =
    loadJson(
      CARS_FILE,
      []
    );



  const previousRates =
    loadJson(
      RATES_FILE,
      {}
    );



  if (
    !Array.isArray(
      cars
    )
  ) {

    throw new Error(
      'cars.json должен содержать массив'
    );

  }



  /*
  ЦБ
  */


  const cbr =
    await getCbrRates();



  /*
  ВТБ
  */


  const browser =
    await chromium.launch({

      headless:
        true

    });



  const vtb =
    await getVtbCnySellRate(

      browser,

      cbr.cnyRub,

      previousRates

    );



  await browser.close();



  /*
  rates.json
  */


  const rates = {


    updatedAt:
      new Date()
        .toISOString(),


    cbr,


    vtbCnySell:
      vtb.rate,


    vtbSource:
      vtb.source,


    vtbObservedAt:
      vtb.observedAt

  };



  saveJson(
    RATES_FILE,
    rates
  );



  /*
  Рассчитываем машины
  */


  const pricedCars =
    cars.map(

      car =>
        calculateCarPrice(
          car,
          rates
        )

    );



  /*
  Сохраняем cars.json
  */


  saveJson(
    CARS_FILE,
    pricedCars
  );



  /*
  Статистика
  */


  const calculated =

    pricedCars.filter(

      car =>
        car.finalPriceRub

    ).length;



  const waiting =

    pricedCars.length -

    calculated;



  console.log(
    '\n===== РАСЧЁТ VAN AUTO ГОТОВ =====\n'
  );



  console.log(
    'Всего машин:',
    pricedCars.length
  );



  console.log(
    'С итоговой ценой ₽:',
    calculated
  );



  console.log(
    'Пока без итоговой цены:',
    waiting
  );



  pricedCars.forEach(

    function (car) {

      console.log(

        car.id,

        car.name,

        car.finalPriceRub

          ? `${car.finalPriceRub} ₽`

          : `НЕ РАССЧИТАНО: ${car.pricingError}`

      );

    }

  );


})();

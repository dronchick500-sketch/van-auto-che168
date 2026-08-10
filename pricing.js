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
ИСТОЧНИКИ
==================================================
*/


const VTB_YUAN_URL =
  'https://www.vtb.ru/personal/platezhi-i-perevody/obmen-valjuty/yuan/';


const VTB_CONVERTER_URL =
  'https://www.vtb.ru/personal/platezhi-i-perevody/konverter/';


const VTB_HOME_URL =
  'https://www.vtb.ru/';


const CBR_URL =
  'https://www.cbr.ru/scripts/XML_daily.asp';



/*
==================================================
БИЗНЕС-ФОРМУЛА VAN AUTO
==================================================
*/


const BANK_COMMISSION = 0.02;


// Постоянные расходы
const FIXED_RUB = 250000;


// Доставка до Санкт-Петербурга
const DELIVERY_SPB_RUB = 210000;


// Порог
const LOW_PRICE_LIMIT_CNY = 110000;


// Китай
const CHINA_LOW_CNY = 12500;
const CHINA_HIGH_CNY = 13000;


// Россия
const RUSSIA_LOW_RUB = 223000;
const RUSSIA_HIGH_RUB = 273000;



/*
==================================================
ТАМОЖНЯ / УТИЛЬ
==================================================
*/


const CUSTOMS_OPERATION_FEE_RUB = 689;


const UTIL_BASE_RUB = 20000;
const UTIL_NEW_COEFF = 0.17;
const UTIL_USED_COEFF = 0.26;


// На сайте пишем "до 160 л.с."
// фактическая граница — 159
const SAFE_POWER_LIMIT_HP = 159;


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

  }

  catch (error) {

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


  const cleaned =
    String(value)

      .replace(/\u00A0/g, '')
      .replace(/\u202F/g, '')
      .replace(/\s/g, '')
      .replace(',', '.');


  const number =
    Number(cleaned);


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
ПРОВЕРКА, ЧТО ЦИФРА ПОХОЖА НА КУРС CNY/RUB
==================================================
*/


function isReasonableCnyRate(
  rate,
  cbrCnyRub
) {

  return (
    rate &&
    Number.isFinite(rate) &&
    rate >= cbrCnyRub * 0.75 &&
    rate <= cbrCnyRub * 1.70
  );

}



/*
==================================================
ПОИСК КУРСА В ТЕКСТЕ
==================================================
*/


function extractRateFromText(
  text,
  cbrCnyRub
) {

  if (!text) {
    return null;
  }


  const cleaned =
    String(text)
      .replace(/\u00A0/g, ' ')
      .replace(/\u202F/g, ' ');


  const lines =
    cleaned
      .split('\n')
      .map(
        line =>
          line
            .replace(/\s+/g, ' ')
            .trim()
      )
      .filter(Boolean);


  const strong = [];
  const weak = [];


  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    if (
      !/CNY|юан|китайск/i.test(
        lines[i]
      )
    ) {
      continue;
    }


    const start =
      Math.max(
        0,
        i - 10
      );


    const end =
      Math.min(
        lines.length,
        i + 25
      );


    const snippet =
      lines
        .slice(start, end)
        .join('\n');


    const directPatterns = [

      /(?:продажа|продать|покупка юан|купить юан|курс продажи)[^\d]{0,120}(\d{1,2}[.,]\d{2,6})/i,

      /(\d{1,2}[.,]\d{2,6})[^\d]{0,120}(?:продажа|продать|купить юан|курс продажи)/i

    ];


    for (
      const regex
      of directPatterns
    ) {

      const match =
        snippet.match(regex);


      if (!match) {
        continue;
      }


      const rate =
        toNumber(
          match[1]
        );


      if (
        isReasonableCnyRate(
          rate,
          cbrCnyRub
        )
      ) {

        strong.push(rate);

      }

    }


    const numbers =
      snippet.match(
        /\b\d{1,2}[.,]\d{2,6}\b/g
      ) || [];


    for (
      const raw
      of numbers
    ) {

      const rate =
        toNumber(raw);


      if (
        isReasonableCnyRate(
          rate,
          cbrCnyRub
        )
      ) {

        weak.push(rate);

      }

    }

  }


  if (
    strong.length
  ) {

    return strong[0];

  }


  if (
    weak.length
  ) {

    /*
    Для покупки юаня клиентом
    осторожно выбираем большее
    разумное значение.
    */

    return Math.max(
      ...weak
    );

  }


  return null;

}



/*
==================================================
ПОИСК КУРСА В JSON / NETWORK RESPONSE
==================================================
*/


function findRatesDeep(
  value,
  cbrCnyRub,
  path = ''
) {

  const found = [];


  if (
    value === null ||
    value === undefined
  ) {
    return found;
  }


  if (
    typeof value === 'number'
  ) {

    if (
      isReasonableCnyRate(
        value,
        cbrCnyRub
      )
    ) {

      found.push({
        rate: value,
        path
      });

    }


    return found;

  }


  if (
    typeof value === 'string'
  ) {

    const number =
      toNumber(value);


    if (
      isReasonableCnyRate(
        number,
        cbrCnyRub
      )
    ) {

      found.push({
        rate: number,
        path
      });

    }


    return found;

  }


  if (
    Array.isArray(value)
  ) {

    value.forEach(
      function (item, index) {

        found.push(
          ...findRatesDeep(
            item,
            cbrCnyRub,
            `${path}[${index}]`
          )
        );

      }
    );


    return found;

  }


  if (
    typeof value === 'object'
  ) {

    for (
      const [key, item]
      of Object.entries(value)
    ) {

      const nextPath =
        path
          ? `${path}.${key}`
          : key;


      found.push(
        ...findRatesDeep(
          item,
          cbrCnyRub,
          nextPath
        )
      );

    }

  }


  return found;

}



/*
==================================================
ПРИОРИТЕТ NETWORK КАНДИДАТА
==================================================
*/


function scoreNetworkRate(item) {

  const path =
    String(
      item.path || ''
    ).toLowerCase();


  let score = 0;


  if (
    /sell|sale|offer|buycurrency|rate/.test(
      path
    )
  ) {
    score += 5;
  }


  if (
    /cny|yuan|rub/.test(
      path
    )
  ) {
    score += 5;
  }


  if (
    /purchase|client/.test(
      path
    )
  ) {
    score += 2;
  }


  return score;

}



/*
==================================================
ОДНА ПОПЫТКА ОТКРЫТЬ ВТБ
+ ПЕРЕХВАТИТЬ JSON
==================================================
*/


async function tryVtbPage(
  browser,
  url,
  label,
  cbrCnyRub
) {

  console.log(
    `\n===== ВТБ: ${label} =====\n`
  );


  const context =
    await browser.newContext({

      locale:
        'ru-RU',

      timezoneId:
        'Europe/Moscow',

      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/126.0.0.0 Safari/537.36',

      viewport: {
        width: 1440,
        height: 1200
      },

      extraHTTPHeaders: {

        'Accept-Language':
          'ru-RU,ru;q=0.9,en;q=0.8'

      }

    });


  const page =
    await context.newPage();


  const networkCandidates = [];


  /*
  Перехватываем XHR/fetch.
  */

  page.on(
    'response',
    async function (response) {

      try {

        const request =
          response.request();


        const resourceType =
          request.resourceType();


        if (
          resourceType !== 'xhr' &&
          resourceType !== 'fetch'
        ) {
          return;
        }


        const responseUrl =
          response.url();


        const contentType =
          String(
            response.headers()['content-type'] ||
            ''
          ).toLowerCase();


        if (
          !contentType.includes(
            'json'
          )
        ) {
          return;
        }


        const body =
          await response.json();


        const rates =
          findRatesDeep(
            body,
            cbrCnyRub
          );


        if (
          rates.length
        ) {

          networkCandidates.push({

            responseUrl,
            rates

          });

        }

      }

      catch (_) {}

    }

  );


  try {

    await page.goto(
      url,
      {
        waitUntil:
          'domcontentloaded',

        timeout:
          45000
      }
    );


    await page.waitForTimeout(
      10000
    );


    /*
    ==============================================
    1. СНАЧАЛА NETWORK JSON
    ==============================================
    */


    const flattened = [];


    for (
      const response
      of networkCandidates
    ) {

      for (
        const rate
        of response.rates
      ) {

        flattened.push({

          ...rate,

          responseUrl:
            response.responseUrl,

          score:
            scoreNetworkRate(rate)

        });

      }

    }


    flattened.sort(
      function (a, b) {

        return (
          b.score -
          a.score
        );

      }
    );


    if (
      flattened.length
    ) {

      console.log(
        'Найдены network-кандидаты ВТБ:'
      );


      flattened
        .slice(0, 10)
        .forEach(
          function (item) {

            console.log(
              item.rate,
              item.path,
              item.responseUrl
            );

          }
        );


      const best =
        flattened[0];


      if (
        best &&
        isReasonableCnyRate(
          best.rate,
          cbrCnyRub
        )
      ) {

        await context.close();


        return {

          rate:
            best.rate,

          source:
            `VTB network: ${label}`,

          observedAt:
            new Date()
              .toISOString(),

          debug: {
            path:
              best.path,

            responseUrl:
              best.responseUrl
          }

        };

      }

    }


    /*
    ==============================================
    2. ЕСЛИ JSON НЕ НАШЛИ —
    ЧИТАЕМ ВИДИМЫЙ ТЕКСТ
    ==============================================
    */


    const text =
      await page
        .locator('body')
        .innerText({
          timeout:
            15000
        });


    console.log(
      `${label}: text length =`,
      text.length
    );


    const textRate =
      extractRateFromText(
        text,
        cbrCnyRub
      );


    if (
      textRate
    ) {

      console.log(
        'Курс найден в тексте:',
        textRate
      );


      await context.close();


      return {

        rate:
          textRate,

        source:
          `VTB page text: ${label}`,

        observedAt:
          new Date()
            .toISOString()

      };

    }


    /*
    ==============================================
    3. ПРОВЕРЯЕМ HTML
    ==============================================
    */


    const html =
      await page.content();


    const htmlRate =
      extractRateFromText(
        html,
        cbrCnyRub
      );


    if (
      htmlRate
    ) {

      console.log(
        'Курс найден в HTML:',
        htmlRate
      );


      await context.close();


      return {

        rate:
          htmlRate,

        source:
          `VTB html: ${label}`,

        observedAt:
          new Date()
            .toISOString()

      };

    }


    console.log(
      `ВТБ ${label}: курс не найден`
    );


  }

  catch (error) {

    console.log(
      `ВТБ ${label}:`,
      error.message
    );

  }


  await context.close();


  return null;

}



/*
==================================================
ОБЩАЯ ЛОГИКА ВТБ
==================================================
*/


async function getVtbCnySellRate(
  browser,
  cbrCnyRub,
  previousRates
) {

  console.log(
    '\n===== ИЩЕМ КУРС ВТБ CNY/RUB =====\n'
  );


  /*
  1. Специализированная страница юаня.
  */

  const yuan =
    await tryVtbPage(
      browser,
      VTB_YUAN_URL,
      'yuan page',
      cbrCnyRub
    );


  if (yuan) {
    return yuan;
  }


  /*
  2. Конвертер ВТБ.
  */

  const converter =
    await tryVtbPage(
      browser,
      VTB_CONVERTER_URL,
      'converter',
      cbrCnyRub
    );


  if (converter) {
    return converter;
  }


  /*
  3. Главная ВТБ.
  Там тоже бывает валютный виджет.
  */

  const home =
    await tryVtbPage(
      browser,
      VTB_HOME_URL,
      'homepage',
      cbrCnyRub
    );


  if (home) {
    return home;
  }


  /*
  4. Последний сохранённый
  официальный курс ВТБ,
  максимум 48 часов.
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
        'Используем сохранённый курс ВТБ:',
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
  Не используем ЦБ вместо ВТБ.
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
ВОЗРАСТ
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
ТАМОЖНЯ ДО 3 ЛЕТ
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

    percent = 0.54;
    minPerCc = 2.5;

  }

  else if (
    valueEur <= 16700
  ) {

    percent = 0.48;
    minPerCc = 3.5;

  }

  else if (
    valueEur <= 42300
  ) {

    percent = 0.48;
    minPerCc = 5.5;

  }

  else if (
    valueEur <= 84500
  ) {

    percent = 0.48;
    minPerCc = 7.5;

  }

  else if (
    valueEur <= 169000
  ) {

    percent = 0.48;
    minPerCc = 15;

  }

  else {

    percent = 0.48;
    minPerCc = 20;

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
ТАМОЖНЯ 3–5 ЛЕТ
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
ТАМОЖНЯ СТАРШЕ 5 ЛЕТ
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
ТАМОЖЕННАЯ ПОШЛИНА
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
ГЛАВНАЯ ФОРМУЛА
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
  Китай
  */


  const chinaExpensesCny =

    priceCny <=
    LOW_PRICE_LIMIT_CNY

      ? CHINA_LOW_CNY

      : CHINA_HIGH_CNY;



  /*
  Россия
  */


  const russiaExpensesRub =

    priceCny <=
    LOW_PRICE_LIMIT_CNY

      ? RUSSIA_LOW_RUB

      : RUSSIA_HIGH_RUB;



  /*
  Цена автомобиля
  + расходы Китая
  */


  const cnyPaymentBase =

    priceCny +
    chinaExpensesCny;



  /*
  По курсу ВТБ
  */


  const paymentRubBeforeBank =

    cnyPaymentBase *

    rates.vtbCnySell;



  /*
  +2%
  */


  const bankCommissionRub =

    paymentRubBeforeBank *

    BANK_COMMISSION;



  const cnyPaymentRub =

    paymentRubBeforeBank +

    bankCommissionRub;



  /*
  Таможня
  */


  const customsTotalRub =

    customs.dutyRub +

    util.feeRub +

    CUSTOMS_OPERATION_FEE_RUB;



  /*
  Итог
  */


  const finalPriceRub =
    roundRub(

      cnyPaymentRub +

      customsTotalRub +

      russiaExpensesRub +

      FIXED_RUB +

      DELIVERY_SPB_RUB

    );



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
      vtb.observedAt,


    vtbDebug:
      vtb.debug || null

  };



  saveJson(
    RATES_FILE,
    rates
  );



  /*
  Считаем машины
  */


  const pricedCars =
    cars.map(

      car =>
        calculateCarPrice(
          car,
          rates
        )

    );



  saveJson(
    CARS_FILE,
    pricedCars
  );



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

const fs = require('fs');


/*
==================================================
VAN AUTO — РАСЧЁТ ИТОГОВОЙ СТОИМОСТИ
==================================================
*/


const CARS_FILE = 'cars.json';
const RATES_FILE = 'rates.json';

const CBR_URL =
  'https://www.cbr.ru/scripts/XML_daily.asp';


/*
==================================================
КУРС ВТБ

Берём из GitHub Repository Variable:

VTB_CNY_RATE

Например:
13.25

ВАЖНО:
это должен быть реальный курс,
по которому мы покупаем CNY.
==================================================
*/


const MANUAL_VTB_CNY_RATE =
  Number(
    String(
      process.env.VTB_CNY_RATE || ''
    )
      .replace(',', '.')
  );


/*
==================================================
БИЗНЕС-ФОРМУЛА VAN AUTO
==================================================
*/


// Комиссия банка 2%
const BANK_COMMISSION = 0.02;


// Постоянная сумма на автомобиль
const FIXED_RUB = 250000;


// Доставка до Санкт-Петербурга
const DELIVERY_SPB_RUB = 210000;


// Граница стоимости автомобиля
const LOW_PRICE_LIMIT_CNY = 110000;


// Расходы по Китаю

// Авто до 110 000 ¥ включительно
const CHINA_LOW_CNY = 12500;

// Авто дороже 110 000 ¥
const CHINA_HIGH_CNY = 13000;


// Расходы по России

// Авто до 110 000 ¥ включительно
const RUSSIA_LOW_RUB = 223000;

// Авто дороже 110 000 ¥
const RUSSIA_HIGH_RUB = 273000;


/*
==================================================
ТАМОЖНЯ / УТИЛЬ
==================================================
*/


// Таможенный сбор за операции
const CUSTOMS_OPERATION_FEE_RUB = 689;


// Льготный утильсбор
const UTIL_BASE_RUB = 20000;

const UTIL_NEW_COEFF = 0.17;
const UTIL_USED_COEFF = 0.26;


// На сайте пишем:
//
// "До 160 л.с."
//
// Но фактически пропускаем
// максимум 159 л.с.
const SAFE_POWER_LIMIT_HP = 159;


// Если точной даты производства нет,
// не считаем автомобили слишком близко
// к границе 3 и 5 лет.
const AGE_BOUNDARY_GUARD_MONTHS = 2;


/*
==================================================
РАБОТА С JSON
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


  const n =
    Number(
      String(value)
        .replace(/\s/g, '')
        .replace(',', '.')
    );


  return Number.isFinite(n)
    ? n
    : null;

}


function roundRub(value) {

  return Math.round(value);

}


/*
==================================================
КУРСЫ ЦБ РФ

Они нужны для расчёта таможни:
CNY → EUR.
==================================================
*/


function parseCbrRate(
  xml,
  code
) {

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
        ? toNumber(
            nominalMatch[1]
          )
        : null;


    const value =
      valueMatch
        ? toNumber(
            valueMatch[1]
          )
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

  /*
  В идеале используем дату производства.

  Если её нет —
  используем первую регистрацию.
  */


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

      ok: false,

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
  Если используем только первую регистрацию
  и машина находится близко к 3 или 5 годам,
  не рискуем показывать клиенту
  неправильную растаможку.
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

        ok: false,

        reason:
          'Нужна точная дата производства: автомобиль близко к границе таможенной возрастной группы',

        source,

        ageMonths

      };

    }

  }


  return {

    ok: true,

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
ТАМОЖНЯ — АВТО ДО 3 ЛЕТ
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

      ok: false,

      reason:
        'Нет цены CHE168'

    };

  }


  /*
  Чистые электромобили
  пока автоматически не считаем.
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

      ok: false,

      reason:
        'Для чистого электромобиля нужен отдельный расчёт'

    };

  }


  if (!engineCc) {

    return {

      ok: false,

      reason:
        'Нет объёма двигателя'

    };

  }


  const age =
    getAgeInfo(car);


  if (!age.ok) {

    return {

      ok: false,

      reason:
        age.reason,

      age

    };

  }


  /*
  Переводим стоимость автомобиля
  из CNY в EUR через официальные
  курсы ЦБ.
  */


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

    ok: true,

    dutyRub,

    dutyEur,

    customsValueEur:
      valueEur,

    age

  };

}


/*
==================================================
УТИЛЬСБОР
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

      ok: false,

      reason:
        'Нет мощности двигателя'

    };

  }


  /*
  Пользователь видит:
  "До 160 л.с."

  Фактическая граница:
  максимум 159 л.с.
  */


  if (
    power >
    SAFE_POWER_LIMIT_HP
  ) {

    return {

      ok: false,

      reason:
        `Мощность ${power} л.с. выше лимита ${SAFE_POWER_LIMIT_HP} л.с.`

    };

  }


  if (
    !ageInfo ||
    !ageInfo.ok
  ) {

    return {

      ok: false,

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

    ok: true,

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
  Нет цены CHE168
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
  Нет курса ВТБ
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
        'Не задан VTB_CNY_RATE'

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
  РАСХОДЫ ПО РОССИИ
  ==============================================
  */


  const russiaExpensesRub =

    priceCny <=
    LOW_PRICE_LIMIT_CNY

      ? RUSSIA_LOW_RUB

      : RUSSIA_HIGH_RUB;


  /*
  ==============================================
  БАЗА ПЛАТЕЖА В CNY

  Автомобиль
  +
  расходы по Китаю
  ==============================================
  */


  const cnyPaymentBase =

    priceCny +

    chinaExpensesCny;


  /*
  ==============================================
  ПЕРЕВОД ПО КУРСУ ВТБ
  ==============================================
  */


  const paymentRubBeforeBank =

    cnyPaymentBase *

    rates.vtbCnySell;


  /*
  ==============================================
  +2% КОМИССИЯ БАНКА

  Начисляется на:

  стоимость авто
  +
  расходы Китай
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
  ТАМОЖЕННЫЕ РАСХОДЫ
  ==============================================
  */


  const customsTotalRub =

    customs.dutyRub +

    util.feeRub +

    CUSTOMS_OPERATION_FEE_RUB;


  /*
  ==============================================
  ИТОГОВАЯ ЦЕНА ДО САНКТ-ПЕТЕРБУРГА

  Китай по ВТБ
  +
  2%
  +
  таможня
  +
  утиль
  +
  таможенный сбор
  +
  расходы РФ
  +
  250 000 ₽
  +
  210 000 ₽ доставка до СПб
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
  ГОТОВЫЙ АВТОМОБИЛЬ
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
    КУРСЫ
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
    КИТАЙ
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
    ТАМОЖНЯ
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
    УТИЛЬ
    */


    utilFeeRub:
      util.feeRub,


    utilCoeff:
      util.coeff,


    /*
    ОСТАЛЬНЫЕ РАСХОДЫ
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
    ПОЛНАЯ РАСШИФРОВКА
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


      paymentRubBeforeBank:
        roundRub(
          paymentRubBeforeBank
        ),


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


  /*
  Проверяем наличие cars.json
  */


  if (
    !fs.existsSync(
      CARS_FILE
    )
  ) {

    throw new Error(
      'cars.json не найден'
    );

  }


  /*
  Читаем автомобили
  */


  const cars =
    loadJson(
      CARS_FILE,
      []
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
  Проверяем курс ВТБ
  */


  if (
    !Number.isFinite(
      MANUAL_VTB_CNY_RATE
    ) ||
    MANUAL_VTB_CNY_RATE <= 0
  ) {

    console.log(
      '\nОШИБКА: переменная VTB_CNY_RATE не задана.\n'
    );


    console.log(
      'GitHub → Settings → Secrets and variables → Actions → Variables'
    );


    console.log(
      'Создай переменную VTB_CNY_RATE.'
    );

  }

  else {

    console.log(
      '\n===== КУРС ВТБ =====\n'
    );


    console.log(
      'VTB CNY/RUB:',
      MANUAL_VTB_CNY_RATE
    );

  }


  /*
  Получаем ЦБ
  */


  const cbr =
    await getCbrRates();


  /*
  Формируем rates.json
  */


  const rates = {


    updatedAt:
      new Date()
        .toISOString(),


    cbr,


    vtbCnySell:

      Number.isFinite(
        MANUAL_VTB_CNY_RATE
      ) &&
      MANUAL_VTB_CNY_RATE > 0

        ? MANUAL_VTB_CNY_RATE

        : null,


    vtbSource:

      Number.isFinite(
        MANUAL_VTB_CNY_RATE
      ) &&
      MANUAL_VTB_CNY_RATE > 0

        ? 'GitHub variable VTB_CNY_RATE'

        : 'unavailable',


    vtbObservedAt:

      Number.isFinite(
        MANUAL_VTB_CNY_RATE
      ) &&
      MANUAL_VTB_CNY_RATE > 0

        ? new Date()
            .toISOString()

        : null

  };


  /*
  Сохраняем rates.json
  */


  saveJson(
    RATES_FILE,
    rates
  );


  /*
  Считаем все автомобили
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
  Перезаписываем cars.json
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
    'Курс ВТБ:',
    rates.vtbCnySell
  );


  console.log(
    'Источник:',
    rates.vtbSource
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

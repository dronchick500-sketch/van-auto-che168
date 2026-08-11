const fs = require('fs');

const CARS_FILE = 'cars.json';
const RATES_FILE = 'rates.json';
const CBR_URL = 'https://www.cbr.ru/scripts/XML_daily.asp';

/*
==================================================
VAN AUTO — НАСТРОЙКИ
==================================================
*/

const BANK_COMMISSION = 0.02;

const FIXED_RUB = 250000;
const DELIVERY_SPB_RUB = 210000;

const LOW_PRICE_LIMIT_CNY = 110000;

const CHINA_LOW_CNY = 12500;
const CHINA_HIGH_CNY = 13000;

const RUSSIA_LOW_RUB = 223000;
const RUSSIA_HIGH_RUB = 273000;

const UTIL_BASE_RUB = 20000;

/*
Курс ВТБ задаём в:

GitHub
Settings
Secrets and variables
Actions
Variables
VTB_CNY_RATE
*/

const VTB_CNY_RATE =
  Number(
    String(
      process.env.VTB_CNY_RATE || ''
    )
      .replace(',', '.')
  );


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
      `Ошибка чтения ${path}:`,
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


function toNumber(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number =
    Number(
      String(value)
        .replace(/\s/g, '')
        .replace(',', '.')
    );

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

  for (const block of blocks) {

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

    if (
      !nominalMatch ||
      !valueMatch
    ) {
      return null;
    }

    const nominal =
      toNumber(
        nominalMatch[1]
      );

    const value =
      toNumber(
        valueMatch[1]
      );

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
    '\n===== КУРСЫ ЦБ РФ ====='
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
      'Не удалось получить CNY/EUR'
    );
  }

  console.log(
    'CNY/RUB:',
    cnyRub
  );

  console.log(
    'EUR/RUB:',
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
      .match(
        /(20\d{2})[.\-/年](\d{1,2})/
      );

  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2])
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
      ok: false,
      reason:
        'Нет даты автомобиля'
    };
  }

  const now =
    new Date();

  const ageMonths =
    (
      now.getUTCFullYear() -
      selected.year
    ) * 12 +
    (
      now.getUTCMonth() + 1 -
      selected.month
    );

  let group;

  if (ageMonths <= 36) {
    group = 'under3';
  } else if (ageMonths <= 60) {
    group = '3to5';
  } else {
    group = 'over5';
  }

  return {
    ok: true,
    group,
    ageMonths,
    source:
      production
        ? 'productionDate'
        : 'registrationDate'
  };
}


/*
==================================================
ТАМОЖЕННАЯ ПОШЛИНА
ДО 3 ЛЕТ
==================================================
*/

function dutyForUnder3(
  valueEur,
  engineCc
) {

  let percent;
  let minPerCc;

  if (valueEur <= 8500) {

    percent = 0.54;
    minPerCc = 2.5;

  } else if (valueEur <= 16700) {

    percent = 0.48;
    minPerCc = 3.5;

  } else if (valueEur <= 42300) {

    percent = 0.48;
    minPerCc = 5.5;

  } else if (valueEur <= 84500) {

    percent = 0.48;
    minPerCc = 7.5;

  } else if (valueEur <= 169000) {

    percent = 0.48;
    minPerCc = 15;

  } else {

    percent = 0.48;
    minPerCc = 20;
  }

  return Math.max(
    valueEur * percent,
    engineCc * minPerCc
  );
}


/*
==================================================
ПОШЛИНА 3–5 ЛЕТ
==================================================
*/

function rate3to5(cc) {

  if (cc <= 1000) return 1.5;
  if (cc <= 1500) return 1.7;
  if (cc <= 1800) return 2.5;
  if (cc <= 2300) return 2.7;
  if (cc <= 3000) return 3.0;

  return 3.6;
}


/*
==================================================
ПОШЛИНА СТАРШЕ 5 ЛЕТ
==================================================
*/

function rateOver5(cc) {

  if (cc <= 1000) return 3.0;
  if (cc <= 1500) return 3.2;
  if (cc <= 1800) return 3.5;
  if (cc <= 2300) return 4.8;
  if (cc <= 3000) return 5.0;

  return 5.7;
}


/*
==================================================
ТАМОЖЕННЫЙ СБОР 2026
==================================================
*/

function customsOperationFee(
  customsValueRub
) {

  if (customsValueRub <= 200000) {
    return 1231;
  }

  if (customsValueRub <= 450000) {
    return 2462;
  }

  if (customsValueRub <= 1200000) {
    return 4924;
  }

  if (customsValueRub <= 2700000) {
    return 13541;
  }

  if (customsValueRub <= 4200000) {
    return 18465;
  }

  if (customsValueRub <= 5500000) {
    return 21344;
  }

  if (customsValueRub <= 10000000) {
    return 49240;
  }

  return 73860;
}


/*
==================================================
УТИЛЬСБОР 2026

Значения ниже — коэффициенты.

Итог:
20 000 ₽ × коэффициент
==================================================
*/


const UTIL_2026 = {

  /*
  До 1 литра
  */

  under1000: {

    160: [14.88, 27.60],
    190: [15.36, 28.43],
    220: [15.84, 29.28],
    250: [16.20, 30.12],
    280: [17.28, 30.12],
    310: [17.28, 30.12],
    340: [17.28, 30.12],
    370: [17.28, 30.12],
    400: [17.28, 30.12],
    430: [17.28, 30.12],
    460: [17.28, 30.12],
    500: [17.28, 30.12],
    Infinity: [17.28, 30.12]

  },


  /*
  1–2 литра
  */

  from1000to2000: {

    160: [40.04, 70.44],
    190: [45.00, 74.60],
    220: [47.64, 79.20],
    250: [50.52, 83.88],
    280: [57.10, 91.40],
    310: [64.56, 100.56],
    340: [72.96, 110.16],
    370: [83.16, 120.60],
    400: [94.80, 132.00],
    430: [108.00, 144.60],
    460: [123.24, 158.40],
    500: [140.40, 173.40],
    Infinity: [160.08, 189.84]

  },


  /*
  2–3 литра
  */

  from2000to3000: {

    160: [112.52, 170.36],
    190: [115.34, 172.80],
    220: [118.20, 175.08],
    250: [120.12, 177.60],
    280: [126.00, 183.00],
    310: [131.04, 187.20],
    340: [136.32, 193.66],
    370: [141.72, 199.08],
    400: [147.28, 204.70],
    430: [153.36, 210.48],
    460: [159.48, 216.36],
    500: [165.84, 222.36],
    Infinity: [172.44, 228.60]

  },


  /*
  3–3.5 литра
  */

  from3000to3500: {

    160: [129.20, 197.81],
    190: [131.76, 200.04],
    220: [134.40, 202.20],
    250: [137.16, 204.36],
    280: [140.52, 207.24],
    310: [144.00, 212.40],
    340: [151.92, 217.80],
    370: [160.32, 224.28],
    400: [169.20, 231.00],
    430: [178.44, 237.96],
    460: [188.28, 245.04],
    500: [198.60, 252.48],
    Infinity: [209.52, 260.04]

  },


  /*
  Более 3.5 литра
  */

  over3500: {

    160: [164.53, 216.29],
    190: [167.28, 219.48],
    220: [170.16, 222.84],
    250: [173.04, 226.20],
    280: [176.52, 231.36],
    310: [180.00, 236.64],
    340: [186.36, 249.60],
    370: [192.88, 263.40],
    400: [199.68, 277.92],
    430: [206.64, 293.16],
    460: [213.84, 309.36],
    500: [221.28, 326.40],
    Infinity: [229.08, 344.28]

  }

};


/*
==================================================
ВЫБОР ГРУППЫ ОБЪЁМА
==================================================
*/

function getUtilVolumeTable(cc) {

  if (cc <= 1000) {
    return UTIL_2026.under1000;
  }

  if (cc <= 2000) {
    return UTIL_2026.from1000to2000;
  }

  if (cc <= 3000) {
    return UTIL_2026.from2000to3000;
  }

  if (cc <= 3500) {
    return UTIL_2026.from3000to3500;
  }

  return UTIL_2026.over3500;
}


/*
==================================================
ПОВЫШЕННЫЙ УТИЛЬ
==================================================
*/

function calculateCommercialUtil(
  engineCc,
  power,
  age
) {

  const table =
    getUtilVolumeTable(
      engineCc
    );

  const limits = [
    160,
    190,
    220,
    250,
    280,
    310,
    340,
    370,
    400,
    430,
    460,
    500,
    Infinity
  ];

  let row =
    table[Infinity];

  let selectedLimit =
    Infinity;

  for (const limit of limits) {

    if (power <= limit) {

      row =
        table[limit];

      selectedLimit =
        limit;

      break;
    }
  }

  /*
  Индекс 0 — до 3 лет
  Индекс 1 — старше 3 лет
  */

  const coeff =
    age.group === 'under3'
      ? row[0]
      : row[1];

  return {

    ok: true,

    type:
      'commercial',

    coeff,

    powerLimit:
      selectedLimit,

    feeRub:
      roundRub(
        UTIL_BASE_RUB *
        coeff
      )

  };
}


/*
==================================================
РАСЧЁТ УТИЛЯ
==================================================
*/

function calculateUtil(
  car,
  age
) {

  const power =
    toNumber(
      car.power
    );

  const engineCc =
    toNumber(
      car.engineVolumeCc
    );

  if (!power) {

    return {
      ok: false,
      reason:
        'Нет мощности'
    };
  }

  if (!engineCc) {

    return {
      ok: false,
      reason:
        'Нет объёма двигателя'
    };
  }


  const fuel =
    String(
      car.fuel || ''
    ).toLowerCase();


  /*
  Электро и гибрид пока
  отправляем на точный расчёт.
  */

  if (
    fuel.includes('электро') ||
    fuel.includes('гибрид')
  ) {

    return {
      ok: false,
      reason:
        'Электро/гибрид требует отдельного расчёта утильсбора'
    };
  }


  /*
  ЛЬГОТНЫЙ УТИЛЬ

  Физлицо
  личное пользование
  ДВС <= 3 л
  мощность <= 160 л.с.
  */

  if (
    engineCc <= 3000 &&
    power <= 160
  ) {

    const coeff =
      age.group === 'under3'
        ? 0.17
        : 0.26;

    return {

      ok: true,

      type:
        'preferential',

      coeff,

      feeRub:
        roundRub(
          UTIL_BASE_RUB *
          coeff
        )

    };
  }


  /*
  Всё остальное —
  повышенный утиль.
  */

  return calculateCommercialUtil(
    engineCc,
    power,
    age
  );
}


/*
==================================================
ТАМОЖНЯ
==================================================
*/

function calculateCustoms(
  car,
  rates
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

  if (!engineCc) {

    return {
      ok: false,
      reason:
        'Нет объёма двигателя'
    };
  }


  const fuel =
    String(
      car.fuel || ''
    ).toLowerCase();


  if (
    fuel.includes('электро')
  ) {

    return {
      ok: false,
      reason:
        'Электромобиль требует отдельного расчёта'
    };
  }


  const age =
    getAgeInfo(
      car
    );

  if (!age.ok) {

    return {
      ok: false,
      reason:
        age.reason
    };
  }


  const customsValueRub =
    priceCny *
    rates.cbr.cnyRub;


  const customsValueEur =
    customsValueRub /
    rates.cbr.eurRub;


  let dutyEur;


  if (
    age.group === 'under3'
  ) {

    dutyEur =
      dutyForUnder3(
        customsValueEur,
        engineCc
      );

  } else if (
    age.group === '3to5'
  ) {

    dutyEur =
      engineCc *
      rate3to5(
        engineCc
      );

  } else {

    dutyEur =
      engineCc *
      rateOver5(
        engineCc
      );
  }


  const dutyRub =
    roundRub(
      dutyEur *
      rates.cbr.eurRub
    );


  const operationFeeRub =
    customsOperationFee(
      customsValueRub
    );


  return {

    ok: true,

    age,

    customsValueRub:
      roundRub(
        customsValueRub
      ),

    customsValueEur,

    dutyEur,

    dutyRub,

    operationFeeRub

  };
}


/*
==================================================
ГЛАВНАЯ ФОРМУЛА VAN AUTO
==================================================
*/

function calculateCar(
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
        'Нет цены CHE168',

      priceIsPreliminary:
        true

    };
  }


  if (!rates.vtbCnySell) {

    return {

      ...car,

      finalPriceRub:
        null,

      pricingStatus:
        'waiting_vtb',

      pricingError:
        'Не задан VTB_CNY_RATE',

      priceIsPreliminary:
        true

    };
  }


  const customs =
    calculateCustoms(
      car,
      rates
    );


  if (!customs.ok) {

    return {

      ...car,

      finalPriceRub:
        null,

      pricingStatus:
        'manual_calculation',

      pricingError:
        customs.reason,

      priceIsPreliminary:
        true

    };
  }


  const util =
    calculateUtil(
      car,
      customs.age
    );


  if (!util.ok) {

    return {

      ...car,

      finalPriceRub:
        null,

      pricingStatus:
        'manual_calculation',

      pricingError:
        util.reason,

      priceIsPreliminary:
        true

    };
  }


  /*
  ==============================================
  КИТАЙ
  ==============================================
  */

  const chinaExpensesCny =
    priceCny <= LOW_PRICE_LIMIT_CNY
      ? CHINA_LOW_CNY
      : CHINA_HIGH_CNY;


  /*
  ==============================================
  РФ
  ==============================================
  */

  const russiaExpensesRub =
    priceCny <= LOW_PRICE_LIMIT_CNY
      ? RUSSIA_LOW_RUB
      : RUSSIA_HIGH_RUB;


  /*
  ==============================================
  ОПЛАТА В КИТАЙ

  (автомобиль + расходы Китай)
  × ВТБ
  + 2%
  ==============================================
  */

  const cnyPaymentBase =
    priceCny +
    chinaExpensesCny;


  const paymentRubBeforeBank =
    cnyPaymentBase *
    rates.vtbCnySell;


  const bankCommissionRub =
    paymentRubBeforeBank *
    BANK_COMMISSION;


  const cnyPaymentRub =
    paymentRubBeforeBank +
    bankCommissionRub;


  /*
  ==============================================
  ВСЯ ТАМОЖНЯ
  ==============================================
  */

  const customsTotalRub =
    customs.dutyRub +
    customs.operationFeeRub +
    util.feeRub;


  /*
  ==============================================
  ФИНАЛ VAN AUTO
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


  return {

    ...car,


    /*
    ==========================================
    ГЛАВНЫЙ РЕЗУЛЬТАТ
    ==========================================
    */

    finalPriceRub,

    priceIsPreliminary:
      true,

    pricingStatus:
      'calculated',

    pricingError:
      null,

    pricingUpdatedAt:
      new Date()
        .toISOString(),


    /*
    ==========================================
    КУРСЫ
    ==========================================
    */

    vtbCnyRate:
      rates.vtbCnySell,

    cbrCnyRate:
      rates.cbr.cnyRub,

    cbrEurRate:
      rates.cbr.eurRub,


    /*
    ==========================================
    КИТАЙ
    ==========================================
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
    ==========================================
    ТАМОЖНЯ
    ==========================================
    */

    customsValueRub:
      customs.customsValueRub,

    customsValueEur:
      Number(
        customs.customsValueEur
          .toFixed(2)
      ),

    customsDutyRub:
      customs.dutyRub,

    customsOperationFeeRub:
      customs.operationFeeRub,

    utilFeeRub:
      util.feeRub,

    utilCoeff:
      util.coeff,

    utilType:
      util.type,

    customsTotalRub,


    /*
    ==========================================
    ВОЗРАСТ
    ==========================================
    */

    customsAgeGroup:
      customs.age.group,

    customsAgeMonths:
      customs.age.ageMonths,

    customsAgeSource:
      customs.age.source,


    /*
    ==========================================
    ОСТАЛЬНЫЕ РАСХОДЫ
    ==========================================
    */

    russiaExpensesRub,

    fixedRub:
      FIXED_RUB,

    deliverySpbRub:
      DELIVERY_SPB_RUB,


    /*
    ==========================================
    ПОЛНАЯ РАСШИФРОВКА
    ==========================================
    */

    pricingBreakdown: {

      vehiclePriceCny:
        priceCny,

      chinaExpensesCny,

      cnyPaymentBase,

      vtbCnyRate:
        rates.vtbCnySell,

      paymentRubBeforeBank:
        roundRub(
          paymentRubBeforeBank
        ),

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

      customsValueRub:
        customs.customsValueRub,

      customsDutyRub:
        customs.dutyRub,

      customsOperationFeeRub:
        customs.operationFeeRub,

      utilFeeRub:
        util.feeRub,

      utilCoeff:
        util.coeff,

      utilType:
        util.type,

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

  console.log(
    '\n================================'
  );

  console.log(
    'VAN AUTO — PRICING 2026'
  );

  console.log(
    '================================\n'
  );


  /*
  ==============================================
  ПРОВЕРКА КУРСА ВТБ
  ==============================================
  */

  if (
    !Number.isFinite(
      VTB_CNY_RATE
    ) ||
    VTB_CNY_RATE <= 0
  ) {

    throw new Error(
      'Не задан корректный GitHub Variable VTB_CNY_RATE'
    );
  }


  console.log(
    'Курс ВТБ CNY/RUB:',
    VTB_CNY_RATE
  );


  /*
  ==============================================
  ЧИТАЕМ МАШИНЫ
  ==============================================
  */

  const cars =
    loadJson(
      CARS_FILE,
      []
    );


  if (!Array.isArray(cars)) {

    throw new Error(
      'cars.json должен содержать массив'
    );
  }


  console.log(
    'Машин в cars.json:',
    cars.length
  );


  /*
  ==============================================
  КУРСЫ ЦБ
  ==============================================
  */

  const cbr =
    await getCbrRates();


  const rates = {

    updatedAt:
      new Date()
        .toISOString(),

    cbr,

    vtbCnySell:
      VTB_CNY_RATE,

    vtbSource:
      'GitHub Variable VTB_CNY_RATE',

    vtbObservedAt:
      new Date()
        .toISOString()

  };


  saveJson(
    RATES_FILE,
    rates
  );


  /*
  ==============================================
  СЧИТАЕМ КАТАЛОГ
  ==============================================
  */

  const pricedCars =
    cars.map(
      car =>
        calculateCar(
          car,
          rates
        )
    );


  saveJson(
    CARS_FILE,
    pricedCars
  );


  /*
  ==============================================
  СТАТИСТИКА
  ==============================================
  */

  const calculated =
    pricedCars.filter(
      car =>
        car.pricingStatus ===
        'calculated'
    );


  const manual =
    pricedCars.filter(
      car =>
        car.pricingStatus ===
        'manual_calculation'
    );


  const waiting =
    pricedCars.filter(
      car =>
        car.pricingStatus !==
          'calculated' &&
        car.pricingStatus !==
          'manual_calculation'
    );


  const powerful =
    calculated.filter(
      car =>
        Number(car.power) > 160
    );


  console.log(
    '\n================================'
  );

  console.log(
    'РАСЧЁТ VAN AUTO ГОТОВ'
  );

  console.log(
    '================================'
  );

  console.log(
    'Всего машин:',
    pricedCars.length
  );

  console.log(
    'Рассчитано:',
    calculated.length
  );

  console.log(
    'Из них >160 л.с.:',
    powerful.length
  );

  console.log(
    'Ручной расчёт:',
    manual.length
  );

  console.log(
    'Ожидают данных:',
    waiting.length
  );


  /*
  Показываем первые рассчитанные
  машины в Actions.
  */

  console.log(
    '\n===== ПРИМЕРЫ =====\n'
  );


  calculated
    .slice(
      0,
      20
    )
    .forEach(
      function (car) {

        console.log(
          `${car.name} | ` +
          `${car.engineVolumeCc || '?'} см3 | ` +
          `${car.power || '?'} л.с. | ` +
          `утиль ${car.utilFeeRub} ₽ | ` +
          `итог ${car.finalPriceRub} ₽`
        );

      }
    );


  if (manual.length) {

    console.log(
      '\n===== НУЖЕН РУЧНОЙ РАСЧЁТ =====\n'
    );

    manual
      .slice(
        0,
        20
      )
      .forEach(
        function (car) {

          console.log(
            `${car.name}: ${car.pricingError}`
          );

        }
      );
  }


  console.log(
    '\n================================\n'
  );

})();

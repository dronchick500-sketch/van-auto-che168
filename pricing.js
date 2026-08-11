const fs = require('fs');

const CARS_FILE = 'cars.json';
const RATES_FILE = 'rates.json';

const CBR_URL =
  'https://www.cbr.ru/scripts/XML_daily.asp';


// ==================================================
// VAN AUTO — НАСТРОЙКИ
// ==================================================

const MIN_CAR_YEAR = 2020;

const BANK_COMMISSION = 0.02;

const FIXED_RUB = 250000;
const DELIVERY_SPB_RUB = 210000;

const LOW_PRICE_LIMIT_CNY = 110000;

const CHINA_LOW_CNY = 12500;
const CHINA_HIGH_CNY = 13000;

const RUSSIA_LOW_RUB = 223000;
const RUSSIA_HIGH_RUB = 273000;


// Базовая ставка утильсбора M1
const UTIL_BASE_RUB = 20000;


// Курс ВТБ берём из GitHub Variable
const VTB_CNY_RATE =
  Number(
    String(
      process.env.VTB_CNY_RATE || ''
    ).replace(',', '.')
  );


// ==================================================
// JSON
// ==================================================

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


// ==================================================
// ЦБ РФ
// ==================================================

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
      'Не удалось получить курсы ЦБ'
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


// ==================================================
// ВОЗРАСТ
// ==================================================

function parseYearMonth(value) {

  if (!value) {
    return null;
  }

  const match =
    String(value).match(
      /(20\d{2})[.\-/年](\d{1,2})/
    );

  if (!match) {
    return null;
  }

  return {
    year:
      Number(match[1]),

    month:
      Number(match[2])
  };
}


function getAgeInfo(car) {

  /*
  Для расчёта сначала ищем дату производства.

  Если CHE168 её не дал —
  используем первую регистрацию
  только для ПРЕДВАРИТЕЛЬНОГО расчёта.
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
        'Нет даты производства/регистрации'
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

  /*
  Для утиля нам важно:
  до 3 лет или старше 3 лет.
  */

  const utilAgeGroup =
    ageMonths <= 36
      ? 'under3'
      : 'over3';

  /*
  Для таможенной пошлины:
  до 3 / 3-5 / старше 5.
  */

  let customsAgeGroup;

  if (ageMonths <= 36) {

    customsAgeGroup =
      'under3';

  } else if (
    ageMonths <= 60
  ) {

    customsAgeGroup =
      '3to5';

  } else {

    customsAgeGroup =
      'over5';
  }

  return {

    ok: true,

    ageMonths,

    utilAgeGroup,

    customsAgeGroup,

    source:
      production
        ? 'productionDate'
        : 'registrationDate',

    estimated:
      !production
  };
}


// ==================================================
// ТАМОЖЕННАЯ ПОШЛИНА
// ==================================================

function dutyForUnder3(
  valueEur,
  engineCc
) {

  let percent;
  let minPerCc;

  if (valueEur <= 8500) {

    percent = 0.54;
    minPerCc = 2.5;

  } else if (
    valueEur <= 16700
  ) {

    percent = 0.48;
    minPerCc = 3.5;

  } else if (
    valueEur <= 42300
  ) {

    percent = 0.48;
    minPerCc = 5.5;

  } else if (
    valueEur <= 84500
  ) {

    percent = 0.48;
    minPerCc = 7.5;

  } else if (
    valueEur <= 169000
  ) {

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


function rate3to5(cc) {

  if (cc <= 1000) return 1.5;
  if (cc <= 1500) return 1.7;
  if (cc <= 1800) return 2.5;
  if (cc <= 2300) return 2.7;
  if (cc <= 3000) return 3.0;

  return 3.6;
}


function rateOver5(cc) {

  if (cc <= 1000) return 3.0;
  if (cc <= 1500) return 3.2;
  if (cc <= 1800) return 3.5;
  if (cc <= 2300) return 4.8;
  if (cc <= 3000) return 5.0;

  return 5.7;
}


// ==================================================
// ТАМОЖЕННЫЙ СБОР
// ==================================================

function customsOperationFee(
  customsValueRub
) {

  if (
    customsValueRub <= 200000
  ) {
    return 1231;
  }

  if (
    customsValueRub <= 450000
  ) {
    return 2462;
  }

  if (
    customsValueRub <= 1200000
  ) {
    return 4924;
  }

  if (
    customsValueRub <= 2700000
  ) {
    return 13541;
  }

  if (
    customsValueRub <= 4200000
  ) {
    return 18465;
  }

  if (
    customsValueRub <= 5500000
  ) {
    return 21344;
  }

  if (
    customsValueRub <= 7000000
  ) {
    return 49240;
  }

  return 73860;
}


// ==================================================
// МОЩНОСТЬ
// ==================================================

function hpToKw(hp) {

  /*
  1 метрическая л.с. =
  0.73549875 кВт
  */

  return hp * 0.73549875;
}


function getPowerBandIndex(
  powerKw
) {

  const limits = [
    51.48,
    73.55,
    95.61,
    117.68,
    139.75,
    161.81,
    183.88,
    205.94,
    228.00,
    250.07,
    272.13,
    294.20,
    316.26,
    338.33,
    367.75,
    Infinity
  ];

  return limits.findIndex(
    limit =>
      powerKw <= limit
  );
}


// ==================================================
// УТИЛЬСБОР 2026
//
// Физическое лицо,
// ввоз для личного пользования.
//
// Значения:
// [новый, старше 3 лет]
//
// Таблица Постановления №1291,
// редакция с №1713.
// ==================================================


// --------------------------------------------------
// ДО 1000 см3
// --------------------------------------------------

const UTIL_2026_TO_1000 = [

  [0.17, 0.26],
  [0.17, 0.26],
  [0.17, 0.26],
  [0.17, 0.26],

  [15.36, 28.44],
  [15.84, 29.28],
  [16.20, 30.12],

  [17.28, 30.12],
  [17.28, 30.12],
  [17.28, 30.12],
  [17.28, 30.12],
  [17.28, 30.12],
  [17.28, 30.12],
  [17.28, 30.12],
  [17.28, 30.12],
  [17.28, 30.12]

];


// --------------------------------------------------
// 1001–2000 см3
// --------------------------------------------------

const UTIL_2026_1000_2000 = [

  [0.17, 0.26],
  [0.17, 0.26],
  [0.17, 0.26],
  [0.17, 0.26],

  [45.00, 74.64],
  [47.64, 79.20],
  [50.52, 83.88],
  [57.12, 91.92],
  [64.56, 100.56],
  [72.96, 110.16],
  [83.16, 120.60],
  [94.80, 132.00],
  [108.00, 144.60],
  [123.24, 158.40],
  [140.40, 173.40],
  [160.08, 189.84]

];


// --------------------------------------------------
// 2001–3000 см3
// --------------------------------------------------

const UTIL_2026_2000_3000 = [

  [0.17, 0.26],
  [0.17, 0.26],
  [0.17, 0.26],
  [0.17, 0.26],

  [115.34, 172.80],
  [118.20, 175.08],
  [120.12, 177.60],
  [126.00, 183.00],
  [131.04, 188.52],
  [136.32, 193.68],
  [141.72, 199.08],
  [147.48, 204.72],
  [153.36, 210.48],
  [159.48, 216.36],
  [165.84, 222.36],
  [172.44, 228.60]

];


// --------------------------------------------------
// 3001–3500 см3
// --------------------------------------------------

const UTIL_2026_3000_3500 = [

  [129.20, 197.81],
  [129.20, 197.81],
  [129.20, 197.81],
  [129.20, 197.81],

  [131.76, 200.04],
  [134.40, 202.20],
  [137.16, 204.36],
  [140.52, 207.24],
  [144.00, 212.40],
  [151.92, 217.80],
  [160.32, 224.28],
  [169.20, 231.00],
  [178.44, 237.96],
  [188.28, 245.04],
  [198.60, 252.48],
  [209.52, 260.04]

];


// --------------------------------------------------
// СВЫШЕ 3500 см3
// --------------------------------------------------

const UTIL_2026_OVER_3500 = [

  [164.53, 216.29],
  [164.53, 216.29],
  [164.53, 216.29],
  [164.53, 216.29],

  [167.28, 219.48],
  [170.16, 222.84],
  [173.04, 226.20],
  [176.52, 231.36],
  [180.00, 236.64],
  [186.36, 249.60],
  [192.88, 263.40],
  [199.68, 277.92],
  [206.64, 293.16],
  [213.84, 309.36],
  [221.28, 326.40],
  [229.08, 344.28]

];


// ==================================================
// ВЫБОР ТАБЛИЦЫ УТИЛЯ
// ==================================================

function getUtilTable(engineCc) {

  if (
    engineCc <= 1000
  ) {
    return UTIL_2026_TO_1000;
  }

  if (
    engineCc <= 2000
  ) {
    return UTIL_2026_1000_2000;
  }

  if (
    engineCc <= 3000
  ) {
    return UTIL_2026_2000_3000;
  }

  if (
    engineCc <= 3500
  ) {
    return UTIL_2026_3000_3500;
  }

  return UTIL_2026_OVER_3500;
}


// ==================================================
// РАСЧЁТ УТИЛЯ
// ==================================================

function calculateUtil(
  car,
  age
) {

  const powerHp =
    toNumber(
      car.power
    );

  const engineCc =
    toNumber(
      car.engineVolumeCc
    );

  if (!powerHp) {

    return {
      ok: false,
      status:
        'missing_power',
      reason:
        'Нет мощности'
    };
  }

  if (!engineCc) {

    return {
      ok: false,
      status:
        'missing_engine',
      reason:
        'Нет объёма двигателя'
    };
  }


  const fuel =
    String(
      car.fuel || ''
    ).toLowerCase();


  /*
  Пока сознательно не публикуем
  EV и гибриды.
  */

  if (
    fuel.includes('электро') ||
    fuel.includes('гибрид') ||
    fuel.includes('electric') ||
    fuel.includes('hybrid')
  ) {

    return {
      ok: false,
      status:
        'special_powertrain',
      reason:
        'EV/гибрид пока не публикуется'
    };
  }


  const powerKw =
    hpToKw(
      powerHp
    );


  const bandIndex =
    getPowerBandIndex(
      powerKw
    );


  if (
    bandIndex < 0
  ) {

    return {
      ok: false,
      status:
        'util_error',
      reason:
        'Не определён диапазон мощности'
    };
  }


  const table =
    getUtilTable(
      engineCc
    );


  const row =
    table[
      bandIndex
    ];


  if (!row) {

    return {
      ok: false,
      status:
        'util_error',
      reason:
        'Нет коэффициента утильсбора'
    };
  }


  const coeff =

    age.utilAgeGroup ===
    'under3'

      ? row[0]

      : row[1];


  const feeRub =
    roundRub(
      UTIL_BASE_RUB *
      coeff
    );


  return {

    ok: true,

    type:
      (
        engineCc <= 3000 &&
        powerHp <= 160
      )
        ? 'preferential'
        : 'progressive_2026',

    coeff,

    feeRub,

    powerHp,

    powerKw:
      Number(
        powerKw.toFixed(2)
      ),

    bandIndex
  };
}


// ==================================================
// ТАМОЖНЯ
// ==================================================

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
      status:
        'missing_price',
      reason:
        'Нет цены CHE168'
    };
  }

  if (!engineCc) {

    return {
      ok: false,
      status:
        'missing_engine',
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
      ok: false,
      status:
        'missing_age',
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
    age.customsAgeGroup ===
    'under3'
  ) {

    dutyEur =
      dutyForUnder3(
        customsValueEur,
        engineCc
      );

  } else if (
    age.customsAgeGroup ===
    '3to5'
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

    customsValueEur:
      Number(
        customsValueEur
          .toFixed(2)
      ),

    dutyRub,

    operationFeeRub
  };
}


// ==================================================
// СКРЫТАЯ КАРТОЧКА
// ==================================================

function hiddenCar(
  car,
  reason,
  error
) {

  return {

    ...car,

    finalPriceRub:
      null,

    publishToCatalog:
      false,

    priceEstimate:
      true,

    priceIsPreliminary:
      true,

    pricingStatus:
      'hidden',

    pricingReason:
      reason,

    pricingError:
      error
  };
}


// ==================================================
// ГЛАВНЫЙ РАСЧЁТ
// ==================================================

function calculateCar(
  car,
  rates
) {

  /*
  Год каталога определяем
  ТОЛЬКО по первой регистрации.
  */

  const registration =
    parseYearMonth(
      car.registrationDate
    );


  if (
    !registration ||
    registration.year <
    MIN_CAR_YEAR
  ) {

    return null;
  }


  const priceCny =
    toNumber(
      car.priceCny
    );


  if (!priceCny) {

    return hiddenCar(
      car,
      'missing_price',
      'Нет цены CHE168'
    );
  }


  if (
    !rates.vtbCnySell
  ) {

    return hiddenCar(
      car,
      'missing_vtb',
      'Нет курса ВТБ'
    );
  }


  const fuel =
    String(
      car.fuel || ''
    ).toLowerCase();


  if (
    fuel.includes('электро') ||
    fuel.includes('гибрид') ||
    fuel.includes('electric') ||
    fuel.includes('hybrid')
  ) {

    return hiddenCar(
      car,
      'special_powertrain',
      'EV/гибрид пока не рассчитывается'
    );
  }


  const customs =
    calculateCustoms(
      car,
      rates
    );


  if (!customs.ok) {

    return hiddenCar(
      car,
      customs.status,
      customs.reason
    );
  }


  const util =
    calculateUtil(
      car,
      customs.age
    );


  if (!util.ok) {

    return hiddenCar(
      car,
      util.status,
      util.reason
    );
  }


  // ----------------------------------------------
  // РАСХОДЫ КИТАЙ
  // ----------------------------------------------

  const chinaExpensesCny =

    priceCny <=
    LOW_PRICE_LIMIT_CNY

      ? CHINA_LOW_CNY

      : CHINA_HIGH_CNY;


  // ----------------------------------------------
  // РАСХОДЫ РФ
  // ----------------------------------------------

  const russiaExpensesRub =

    priceCny <=
    LOW_PRICE_LIMIT_CNY

      ? RUSSIA_LOW_RUB

      : RUSSIA_HIGH_RUB;


  // ----------------------------------------------
  // ОПЛАТА КИТАЙ
  // ----------------------------------------------

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


  // ----------------------------------------------
  // ТАМОЖНЯ
  // ----------------------------------------------

  const customsTotalRub =

    customs.dutyRub +

    customs.operationFeeRub +

    util.feeRub;


  // ----------------------------------------------
  // ФИНАЛ
  // ----------------------------------------------

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


    // ============================================
    // ПУБЛИКАЦИЯ
    // ============================================

    publishToCatalog:
      true,

    finalPriceRub,

    priceEstimate:
      true,

    priceIsPreliminary:
      true,

    pricingStatus:
      'calculated',

    pricingReason:
      null,

    pricingError:
      null,

    pricingUpdatedAt:
      new Date()
        .toISOString(),


    // ============================================
    // ВОЗРАСТ
    // ============================================

    calculationAgeSource:
      customs.age.source,

    calculationAgeEstimated:
      customs.age.estimated,

    calculationAgeMonths:
      customs.age.ageMonths,


    // ============================================
    // КУРСЫ
    // ============================================

    vtbCnyRate:
      rates.vtbCnySell,

    cbrCnyRate:
      rates.cbr.cnyRub,

    cbrEurRate:
      rates.cbr.eurRub,


    // ============================================
    // КИТАЙ
    // ============================================

    chinaExpensesCny,

    cnyPaymentBase,

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


    // ============================================
    // ТАМОЖНЯ
    // ============================================

    customsValueRub:
      customs.customsValueRub,

    customsValueEur:
      customs.customsValueEur,

    customsDutyRub:
      customs.dutyRub,

    customsOperationFeeRub:
      customs.operationFeeRub,


    // ============================================
    // УТИЛЬ
    // ============================================

    utilFeeRub:
      util.feeRub,

    utilCoeff:
      util.coeff,

    utilType:
      util.type,

    powerKw:
      util.powerKw,


    // ============================================
    // ОСТАЛЬНЫЕ РАСХОДЫ
    // ============================================

    customsTotalRub,

    russiaExpensesRub,

    fixedRub:
      FIXED_RUB,

    deliverySpbRub:
      DELIVERY_SPB_RUB,


    // ============================================
    // РАСШИФРОВКА
    // ============================================

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

      utilCoeff:
        util.coeff,

      utilFeeRub:
        util.feeRub,

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


// ==================================================
// ЗАПУСК
// ==================================================

(async () => {

  console.log(
    '\n================================'
  );

  console.log(
    'VAN AUTO — PRICING 2026 FINAL'
  );

  console.log(
    '================================\n'
  );


  if (
    !Number.isFinite(
      VTB_CNY_RATE
    ) ||
    VTB_CNY_RATE <= 0
  ) {

    throw new Error(
      'Не задан VTB_CNY_RATE'
    );
  }


  console.log(
    'Курс ВТБ:',
    VTB_CNY_RATE
  );


  const sourceCars =
    loadJson(
      CARS_FILE,
      []
    );


  if (
    !Array.isArray(
      sourceCars
    )
  ) {

    throw new Error(
      'cars.json должен содержать массив'
    );
  }


  console.log(
    'Машин до фильтра:',
    sourceCars.length
  );


  /*
  Отбор каталога строго
  по первой регистрации.
  */

  const cars =
    sourceCars.filter(
      function (car) {

        const registration =
          parseYearMonth(
            car.registrationDate
          );

        return (
          registration &&
          registration.year >=
          MIN_CAR_YEAR
        );
      }
    );


  console.log(
    'Первая регистрация 2020+:',
    cars.length
  );


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


  const result =
    cars
      .map(
        car =>
          calculateCar(
            car,
            rates
          )
      )
      .filter(Boolean);


  saveJson(
    CARS_FILE,
    result
  );


  // ==================================================
  // СТАТИСТИКА
  // ==================================================

  const published =
    result.filter(
      car =>
        car.publishToCatalog ===
        true
    );


  const hidden =
    result.filter(
      car =>
        car.publishToCatalog !==
        true
    );


  const preferential =
    published.filter(
      car =>
        car.utilType ===
        'preferential'
    );


  const progressive =
    published.filter(
      car =>
        car.utilType ===
        'progressive_2026'
    );


  const missingPrice =
    hidden.filter(
      car =>
        car.pricingReason ===
        'missing_price'
    );


  const specialPowertrain =
    hidden.filter(
      car =>
        car.pricingReason ===
        'special_powertrain'
    );


  const otherHidden =
    hidden.filter(
      car =>
        car.pricingReason !==
          'missing_price' &&
        car.pricingReason !==
          'special_powertrain'
    );


  console.log(
    '\n================================'
  );

  console.log(
    'VAN AUTO — PRICING ГОТОВО'
  );

  console.log(
    '================================'
  );


  console.log(
    'Всего автомобилей:',
    result.length
  );

  console.log(
    'Опубликовано в каталог:',
    published.length
  );

  console.log(
    'Льготный утиль:',
    preferential.length
  );

  console.log(
    'Повышенный утиль 2026:',
    progressive.length
  );

  console.log(
    'Скрыто без цены:',
    missingPrice.length
  );

  console.log(
    'Скрыто EV/Hybrid:',
    specialPowertrain.length
  );

  console.log(
    'Скрыто прочее:',
    otherHidden.length
  );


  console.log(
    '\n===== ОПУБЛИКОВАННЫЕ МАШИНЫ =====\n'
  );


  published
    .slice(
      0,
      50
    )
    .forEach(
      function (car) {

        console.log(

          `${car.name} | ` +

          `${car.registrationDate} | ` +

          `${car.engineVolumeCc} см3 | ` +

          `${car.power} л.с. | ` +

          `${car.powerKw} кВт | ` +

          `коэфф. ${car.utilCoeff} | ` +

          `утиль ${car.utilFeeRub} ₽ | ` +

          `итог ${car.finalPriceRub} ₽`

        );
      }
    );


  console.log(
    '\n===== СКРЫТО =====\n'
  );


  hidden
    .slice(
      0,
      50
    )
    .forEach(
      function (car) {

        console.log(

          `${car.name} | ` +

          `${car.pricingReason} | ` +

          `${car.pricingError}`

        );
      }
    );


  console.log(
    '\n================================\n'
  );

})();

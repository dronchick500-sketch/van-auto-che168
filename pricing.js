const fs = require('fs');

const CARS_FILE = 'cars.json';
const RATES_FILE = 'rates.json';

const CBR_URL =
  'https://www.cbr.ru/scripts/XML_daily.asp';

const MIN_CAR_YEAR = 2020;

const BANK_COMMISSION = 0.02;

const FIXED_RUB = 250000;
const DELIVERY_SPB_RUB = 210000;

const LOW_PRICE_LIMIT_CNY = 110000;

const CHINA_LOW_CNY = 12500;
const CHINA_HIGH_CNY = 13000;

const RUSSIA_LOW_RUB = 223000;
const RUSSIA_HIGH_RUB = 273000;

const UTIL_BASE_RUB = 20000;

const VTB_CNY_RATE =
  Number(
    String(
      process.env.VTB_CNY_RATE || ''
    ).replace(',', '.')
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
      fs.readFileSync(path, 'utf8')
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
    JSON.stringify(data, null, 2) + '\n',
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

    if (!nominalMatch || !valueMatch) {
      return null;
    }

    const nominal =
      toNumber(nominalMatch[1]);

    const value =
      toNumber(valueMatch[1]);

    if (!nominal || !value) {
      return null;
    }

    return value / nominal;
  }

  return null;
}


async function getCbrRates() {
  console.log('\n===== КУРСЫ ЦБ РФ =====');

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
    parseCbrRate(xml, 'CNY');

  const eurRub =
    parseCbrRate(xml, 'EUR');

  if (!cnyRub || !eurRub) {
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
    String(value).match(
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
        'Нет даты выпуска/регистрации'
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
ПОШЛИНА
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


/*
==================================================
ТАМОЖЕННЫЙ СБОР
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

  if (customsValueRub <= 7000000) {
    return 49240;
  }

  return 73860;
}


/*
==================================================
ЛЬГОТНЫЙ УТИЛЬ
==================================================
*/

function calculatePreferentialUtil(
  car,
  age
) {
  const power =
    toNumber(car.power);

  const engineCc =
    toNumber(
      car.engineVolumeCc
    );

  if (!power) {
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

  if (
    fuel.includes('электро') ||
    fuel.includes('гибрид')
  ) {
    return {
      ok: false,
      status:
        'special_powertrain',
      reason:
        'Электро/гибрид требует отдельного расчёта'
    };
  }

  /*
  Льготный расчёт оставляем
  только для ДВС до 3 л
  и до 160 л.с. включительно.
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

  return {
    ok: false,
    status:
      'needs_util_table',
    reason:
      'Для мощности выше 160 л.с. нужен коэффициент утильсбора 2026'
  };
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
    getAgeInfo(car);

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
      rate3to5(engineCc);

  } else {
    dutyEur =
      engineCc *
      rateOver5(engineCc);
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

    dutyRub,

    operationFeeRub
  };
}


/*
==================================================
ГЛАВНЫЙ РАСЧЁТ
==================================================
*/

function calculateCar(
  car,
  rates
) {
  const year =
    Number(car.year);

  /*
  Жёстко убираем всё до 2020.
  */

  if (
    !Number.isFinite(year) ||
    year < MIN_CAR_YEAR
  ) {
    return null;
  }

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
        'waiting_data',

      pricingReason:
        'missing_price',

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
        'waiting_data',

      pricingReason:
        'missing_vtb',

      pricingError:
        'Нет курса ВТБ',

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
        'waiting_data',

      pricingReason:
        customs.status,

      pricingError:
        customs.reason,

      priceIsPreliminary:
        true
    };
  }


  const util =
    calculatePreferentialUtil(
      car,
      customs.age
    );

  if (!util.ok) {
    return {
      ...car,

      finalPriceRub:
        null,

      pricingStatus:
        util.status ===
        'needs_util_table'
          ? 'needs_util_table'
          : 'manual_calculation',

      pricingReason:
        util.status,

      pricingError:
        util.reason,

      customsDutyRub:
        customs.dutyRub,

      customsOperationFeeRub:
        customs.operationFeeRub,

      priceIsPreliminary:
        true
    };
  }


  const chinaExpensesCny =
    priceCny <=
    LOW_PRICE_LIMIT_CNY
      ? CHINA_LOW_CNY
      : CHINA_HIGH_CNY;


  const russiaExpensesRub =
    priceCny <=
    LOW_PRICE_LIMIT_CNY
      ? RUSSIA_LOW_RUB
      : RUSSIA_HIGH_RUB;


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


  const customsTotalRub =
    customs.dutyRub +
    customs.operationFeeRub +
    util.feeRub;


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

    vtbCnyRate:
      rates.vtbCnySell,

    cbrCnyRate:
      rates.cbr.cnyRub,

    cbrEurRate:
      rates.cbr.eurRub,

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
    'VAN AUTO — PRICING DIAGNOSTIC'
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
    'До фильтра по году:',
    sourceCars.length
  );


  const cars =
    sourceCars.filter(
      function (car) {
        const year =
          Number(car.year);

        return (
          Number.isFinite(year) &&
          year >= MIN_CAR_YEAR
        );
      }
    );


  console.log(
    'После фильтра 2020+:',
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


  const calculatedCars =
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
    calculatedCars
  );


  const calculated =
    calculatedCars.filter(
      car =>
        car.pricingStatus ===
        'calculated'
    );


  const needsUtil =
    calculatedCars.filter(
      car =>
        car.pricingStatus ===
        'needs_util_table'
    );


  const manual =
    calculatedCars.filter(
      car =>
        car.pricingStatus ===
        'manual_calculation'
    );


  const waiting =
    calculatedCars.filter(
      car =>
        car.pricingStatus ===
        'waiting_data'
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
    'Всего 2020+:',
    calculatedCars.length
  );

  console.log(
    'Рассчитано:',
    calculated.length
  );

  console.log(
    'Нужна таблица утиля 160+:',
    needsUtil.length
  );

  console.log(
    'Ручной расчёт:',
    manual.length
  );

  console.log(
    'Не хватает данных:',
    waiting.length
  );


  console.log(
    '\n===== РАССЧИТАНО =====\n'
  );

  calculated
    .slice(0, 30)
    .forEach(
      function (car) {
        console.log(
          `${car.name} | ` +
          `${car.year} | ` +
          `${car.engineVolumeCc || '?'} см3 | ` +
          `${car.power || '?'} л.с. | ` +
          `утиль ${car.utilFeeRub} ₽ | ` +
          `итог ${car.finalPriceRub} ₽`
        );
      }
    );


  console.log(
    '\n===== 160+ — НУЖНА ТАБЛИЦА УТИЛЯ =====\n'
  );

  needsUtil
    .slice(0, 50)
    .forEach(
      function (car) {
        console.log(
          `${car.name} | ` +
          `${car.year} | ` +
          `${car.engineVolumeCc || '?'} см3 | ` +
          `${car.power || '?'} л.с.`
        );
      }
    );


  console.log(
    '\n===== НЕ ХВАТАЕТ ДАННЫХ =====\n'
  );

  waiting
    .slice(0, 50)
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
    '\n===== РУЧНОЙ РАСЧЁТ =====\n'
  );

  manual
    .slice(0, 50)
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
